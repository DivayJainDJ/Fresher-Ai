import axios from "axios";

const getStoredSessionId = () => {
    if (typeof window === "undefined") {
        return null
    }

    return window.localStorage.getItem("sessionId")
}

const api = axios.create({
    baseURL: import.meta.env.VITE_BACKEND_URL || "https://interview-ai-backend-new.onrender.com",
    withCredentials: true
})

const pendingRequests = new Map()

api.interceptors.request.use((config) => {
    const sessionId = getStoredSessionId()
    if (sessionId) {
        config.headers["x-session-id"] = sessionId
    }

    if (config.method === "get") {
        const key = config.url
        if (pendingRequests.has(key)) {
            return Promise.reject({ __deduped: true, config })
        }
        pendingRequests.set(key, true)
    }

    return config
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

api.interceptors.response.use(
    (response) => {
        if (response.config.method === "get") {
            pendingRequests.delete(response.config.url)
        }
        return response
    },
    async (error) => {
        if (error.config?.method === "get") {
            pendingRequests.delete(error.config.url)
        }

        if (error.__deduped) {
            return Promise.reject(error)
        }

        // Auto-recover from rate limits once, invisibly, instead of
        // immediately surfacing a raw error to the user. The gateway
        // sends a Retry-After header/body telling us exactly how long
        // to wait.
        const status = error.response?.status
        const config = error.config || {}

        if (status === 429 && !config.__retriedAfterRateLimit) {
            const retryAfterSec =
                Number(error.response?.data?.retryAfter) ||
                Number(error.response?.headers?.["retry-after"]) ||
                5

            config.__retriedAfterRateLimit = true
            await sleep(Math.min(retryAfterSec, 20) * 1000)
            return api(config)
        }

        // Attach a friendly, ready-to-display message so components
        // don't need to know about status codes / provider errors.
        if (status === 429) {
            error.friendlyMessage =
                "This is running on a free plan and is a little busy right now. Please try again in a few seconds."
        } else if (status === 504) {
            error.friendlyMessage =
                "The server is waking up from sleep (free hosting spins down when idle). Please try again in ~30 seconds."
        } else if (!error.response) {
            error.friendlyMessage =
                "Couldn't reach the server. It may be waking up — please try again shortly."
        }

        return Promise.reject(error)
    }
)

export default api
