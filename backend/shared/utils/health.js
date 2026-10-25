import mongoose from "mongoose";
import redis from "../redis/redis.js";

export const dependencyHealth = async (service, res) => {
  try {
    const [redisStatus] = await Promise.all([redis.ping()]);
    if (redisStatus !== "PONG") throw new Error("Redis did not respond with PONG");
    if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is not connected");
    return res.status(200).json({ status: "ok", service, dependencies: { redis: "ok", mongodb: "ok" } });
  } catch (error) {
    return res.status(503).json({ status: "error", service, message: error.message });
  }
};
