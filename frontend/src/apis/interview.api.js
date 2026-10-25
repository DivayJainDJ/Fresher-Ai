import api from "../utils/axios"


export const startInterview = async (data) => {
    try {
        const response = await api.post("/api/interview/start" , data)
        return { ...response.data, interviewCoin: Number(response.headers["x-interview-coins"]) }
    } catch (error) {
        console.log(error)
        throw error
    }
}

export const getInterview = async (id) => {
    try {
        const response = await api.get(`/api/interview/${id}`)
        console.log(response.data)
        return response.data
    } catch (error) {
        console.log(error)
        return null
    }
}


export const submitAnswer = async (data) => {
     try {
        const response = await api.post(`/api/interview/answer` , data)
       
        return response.data
    } catch (error) {
        console.log(error)
        return null
    }
}

export const getAllInterviews = async () => {
     try {
        const response = await api.get(`/api/interview/all`)
        console.log(response.data)
        return response.data
    } catch (error) {
        console.log(error)
        return null
    }
}

export const submitAnswerStream = async (data, { signal, onToken } = {}) => {
    const sessionId = typeof window !== "undefined" ? window.localStorage.getItem("sessionId") : null
    const response = await fetch(new URL("/api/interview/feedback/stream", api.defaults.baseURL), {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(sessionId ? { "x-session-id": sessionId } : {}),
        },
        body: JSON.stringify({
            ...data,
            idempotencyKey: data.idempotencyKey || (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
        }),
        cache: "no-store",
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message || `Feedback request failed (${response.status})`)
    }
    if (!response.body) throw new Error("Streaming responses are not supported in this browser")

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let eventName = "message"
    let dataLines = []
    let result = null

    const dispatch = async () => {
        if (!dataLines.length) { eventName = "message"; return }
        const payload = JSON.parse(dataLines.join("\n"))
        if (eventName === "token") onToken?.(payload.token || "")
        else if (eventName === "done") result = payload
        else if (eventName === "error") throw new Error(payload.message || "Feedback stream failed")
        eventName = "message"
        dataLines = []
    }

    while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""
        for (const line of lines) {
            if (line === "") { await dispatch(); continue }
            if (line.startsWith(":")) continue
            if (line.startsWith("event:")) eventName = line.slice(6).trim()
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
        }
        if (done) break
    }
    if (buffer) {
        if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart())
        await dispatch()
    }
    if (!result) throw new Error("Feedback stream ended before completion")
    return result
}
