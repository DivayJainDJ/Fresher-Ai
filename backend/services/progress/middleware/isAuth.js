import redis from "../../../shared/redis/redis.js";
import User from "../../auth/model/user.model.js";

export const isAuth = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.session || req.headers["x-session-id"];
    if (!sessionId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const session = await redis.get(`session:${sessionId}`);
    if (!session) return res.status(401).json({ success: false, message: "Session expired" });
    const data = JSON.parse(session);
    const user = await User.findById(data.userId).select("name email");
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    req.user = { ...data, name: user.name, email: user.email };
    next();
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "auth_failed", requestId: req.headers["x-request-id"] || null, error: error.message }));
    return res.status(503).json({ success: false, message: "Authentication service unavailable" });
  }
};
