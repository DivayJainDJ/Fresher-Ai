import redis from "../../../shared/redis/redis.js";
import User from "../../auth/model/user.model.js";

export const isAuth = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.session || req.headers["x-session-id"];
    if (!sessionId) return res.status(401).json({ message: "Unauthorized" });
    const session = await redis.get(`session:${sessionId}`);
    if (!session) return res.status(401).json({ message: "Session expired" });
    const data = JSON.parse(session);
    const user = await User.findById(data.userId).select("name email");
    if (!user) return res.status(401).json({ message: "User not found" });
    req.user = { ...data, name: user.name, email: user.email };
    return next();
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "auth_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Authentication service unavailable" });
  }
};
