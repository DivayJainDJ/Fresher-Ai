import axios from "axios"
import api from "../utils/axios"
import { auth } from "../utils/firebase"
import { signOut } from "firebase/auth"

export const loginWithFirebaseToken = async (token) => {
    const response = await api.post("/api/auth/login", { token })
    const sessionId = response?.data?.sessionId

    if (sessionId && typeof window !== "undefined") {
        window.localStorage.setItem("sessionId", sessionId)
    }

    return response.data
}

export const logoutUser = async () => {
    try {
        await api.get("/api/auth/logout")
    } finally {
        if (typeof window !== "undefined") {
            window.localStorage.removeItem("sessionId")
        }

        await signOut(auth).catch(() => {})
    }
}

export const getCurrentUser = async () => {
    try {
        const response = await api.get("/api/me")
        return response.data
    } catch {
        return null
    }
}

export const shouldBlockOnCoinError = (error) => {
    const status = error?.response?.status
    return status === 400 || status === 401 || status === 402 || status === 403
}
