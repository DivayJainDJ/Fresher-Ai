import crypto from "crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "../configs/firebase.js";
import User from "../model/user.model.js";
import redis from "../../../shared/redis/redis.js";
import { createUserWithWelcomeCredits } from "../../../shared/utils/coinAccounting.js";
import CreditLedger from "../../billing/models/creditLedger.model.js";
import { z } from "zod";

const getSessionId = (req) =>
  req.cookies?.session ||
  req.headers["x-session-id"];

const getSessionCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
};

const clearSessionCookie = (res) => {
  res.clearCookie("session", { ...getSessionCookieOptions() });
  res.clearCookie("session", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
  res.clearCookie("session", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
  });
};

const saveSession = async (sessionId, user) => {
  await redis.set(
    `session:${sessionId}`,
    JSON.stringify({
      userId: user._id,
      name: user.name,
      email: user.email,
      interviewCoin: user.interviewCoin,
    }),
    "EX",
    60 * 60 * 24 * 7
  );
};

export const login = async (req, res) => {
  try {
    const { token } = req.body;


    const decoded = await getAuth(getFirebaseApp()).verifyIdToken(token);


    let user = await User.findOne({
      firebaseUid: decoded.uid,
    });

    if (!user) {
      user = await createUserWithWelcomeCredits({
        User,
        Ledger: CreditLedger,
        userData: { firebaseUid: decoded.uid, email: decoded.email, name: decoded.name },
      });
    } else {
      user.name = decoded.name || user.name;
      user.email = decoded.email || user.email;
      await user.save();
    }

    const sessionId = crypto.randomUUID();
    await saveSession(sessionId, user);

    res.cookie("session", sessionId, {
      ...getSessionCookieOptions(),
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return res.json({ success: true, user, sessionId });
  } catch (error) {
    console.error("auth login failed", error);
    return res.status(401).json({ message: error.message });
  }
};

export const logout = async (req, res) => {
  try {
    const sessionId = getSessionId(req);

    if (sessionId) {
      await redis.del(`session:${sessionId}`);
    }

    clearSessionCookie(res);

    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
