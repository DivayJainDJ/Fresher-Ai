import axios from "axios";

const getStoredSessionId = () => {
    if (typeof window === "undefined") {
        return null
    }

    return window.localStorage.getItem("sessionId")
}

const api = axios.create({
    baseURL: import.meta.env.VITE_BACKEND_URL || "https://fresherai-gateway-163537039187.asia-south1.run.app",
    withCredentials: true
})

const pendingRequests = new Map()

api.interceptors.request.use((config) => {
    const sessionId = getStoredSessionId()
    if (sessionId) {
        config.headers["x-session-id"] = sessionId
    }
    try { config.headers["x-timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } catch { config.headers["x-timezone"] = "UTC" }

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

        const status = error.response?.status
        const config = error.config || {}

        // Attach a friendly, ready-to-display message so components
        // don't need to know about status codes / provider errors.
        if (status === 429) {
            const retryAfterSec = Math.max(1, Number(error.response?.data?.retryAfter) || Number(error.response?.headers?.["retry-after"]) || 5)
            error.retryAfterSec = retryAfterSec
            error.friendlyMessage = `Too many requests. Please wait ${retryAfterSec} seconds, then try again.`
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
