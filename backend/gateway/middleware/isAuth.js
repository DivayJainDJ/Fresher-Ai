import redis from "../../shared/redis/redis.js"
import User from "../../services/auth/model/user.model.js"

export const isAuth = async (req, res, next) => {
    try {
        const sessionId =
            req.cookies?.session ||
            req.headers["x-session-id"]

        if (!sessionId) {
            return res.status(401).json({
                message: "Unauthorized"
            })
        }

        const session = await redis.get(`session:${sessionId}`)

        if (!session) {
            return res.status(401).json({
                message: "Session Expired"
            })
        }

        const user = JSON.parse(session)
        const currentUser = await User.findById(user.userId).select("interviewCoin name email")
        if (!currentUser) return res.status(401).json({ message: "User not found" })
        req.user = { ...user, interviewCoin: currentUser.interviewCoin, name: currentUser.name, email: currentUser.email }

        next()

    } catch (error) {
        console.error("AUTH REDIS ERROR:", error)

        return res.status(500).json({
            message: "Authentication service unavailable"
        })
    }
}
