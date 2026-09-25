import express from "express"
import dotenv from "dotenv"
dotenv.config()
import cors from "cors"
import morgan from "morgan"
import cookieParser from "cookie-parser"
import { getCurrentUser } from "./controllers/user.controller.js"
import { isAuth } from "./middleware/isAuth.js"
import { proxyWithHeaders } from "./utils/proxyWithHeaders.js"
import { rateLimiter } from "./middleware/rateLimiter.js"

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason)
})
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error)
})

const app = express()

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))
app.set("trust proxy", 1)
app.use(express.json({ limit: "5mb" }))
app.use(cookieParser())

const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

const isAllowedOrigin = (origin) => {
    if (!origin) return true
    if (allowedOrigins.includes(origin)) return true
    try {
        const { hostname } = new URL(origin)
        return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname.endsWith(".vercel.app")
        )
    } catch {
        return false
    }
}

app.use(
    cors({
        origin(origin, callback) {
            if (allowedOrigins.length === 0 || isAllowedOrigin(origin)) {
                return callback(null, true)
            }
            return callback(new Error(`Origin ${origin} not allowed by CORS`))
        },
        credentials: true,
    })
)

app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "gateway", uptime: process.uptime() })
})

app.get("/", (_req, res) => {
    res.send("Hello from Gateway")
})

const warmServices = () => {
    const services = [
        process.env.AUTH_SERVICE_URL,
        process.env.RESUME_SERVICE_URL,
        process.env.INTERVIEW_SERVICE_URL,
        process.env.ROADMAP_SERVICE_URL,
        process.env.BILLING_SERVICE_URL,
    ].filter(Boolean)

    for (const url of services) {
        fetch(`${url}/health`, { signal: AbortSignal.timeout(15000) })
            .then(() => console.log(`Warmed: ${url}`))
            .catch(() => {})
    }
}

// Warm the downstream services on boot, then keep re-warming them
// every 10 minutes so they don't spin down on Render's free tier
// as long as the gateway itself is being kept awake (see README —
// point a free external pinger like cron-job.org/UptimeRobot at
// this gateway's /health every 10 min to keep the whole chain warm).
setTimeout(warmServices, 3000)
setInterval(warmServices, 10 * 60 * 1000)

app.use((req, res, next) => {
    const timeout = req.path.includes("/generate") || req.path.includes("/upload")
        ? 180_000
        : 60_000

    req.setTimeout(timeout, () => {
        if (!res.headersSent) {
            res.status(504).json({ message: "Request timed out" })
        }
    })

    res.setTimeout(timeout, () => {
        if (!res.headersSent) {
            res.status(504).json({ message: "Response timed out" })
        }
    })

    next()
})

// Per-user limit on the AI-heavy routes. This protects the shared
// free-tier LLM quota from a single user exhausting it for everyone
// else, and returns a friendly, parseable 429 instead of letting the
// upstream provider's raw rate-limit error leak to the client.
const aiRateLimiter = rateLimiter(12, 60_000) // 12 generate calls / minute / user

app.use("/api/auth", proxyWithHeaders(process.env.AUTH_SERVICE_URL, "/api/auth"))
app.use("/api/resume", isAuth, aiRateLimiter, proxyWithHeaders(process.env.RESUME_SERVICE_URL, "/api/resume"))
app.use("/api/interview", isAuth, aiRateLimiter, proxyWithHeaders(process.env.INTERVIEW_SERVICE_URL, "/api/interview"))
app.use("/api/roadmap", isAuth, aiRateLimiter, proxyWithHeaders(process.env.ROADMAP_SERVICE_URL, "/api/roadmap"))
app.use("/api/billing/verify", proxyWithHeaders(process.env.BILLING_SERVICE_URL, "/api/billing"))
app.use("/api/billing", isAuth, proxyWithHeaders(process.env.BILLING_SERVICE_URL, "/api/billing"))
app.get("/api/me", isAuth, getCurrentUser)

app.use((_req, res) => {
    res.status(404).json({ message: "Not found" })
})

app.use((error, req, res, _next) => {
    console.error("gateway error", error)
    const origin = req.headers.origin
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Access-Control-Allow-Credentials", "true")
    }
    if (!res.headersSent) {
        return res.status(500).json({ message: error.message || "Internal server error" })
    }
})

const server = app.listen(process.env.PORT || 8000, "0.0.0.0", () => {
    console.log(`Gateway Started on ${process.env.PORT || 8000}`)
})

const shutdown = (signal) => {
    console.log(`\n${signal} received – shutting down gateway gracefully`)
    server.close(() => {
        console.log("Gateway HTTP server closed")
        process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
