import razorpay from "../configs/razorpay.js";
import Billing from "../models/billing.model.js";
import User from "../../auth/model/user.model.js";
import redis from "../../../shared/redis/redis.js";
import { verifyPaymentSignature, verifyWebhookSignature } from "../../../shared/utils/paymentSignature.js";
import CreditLedger from "../models/creditLedger.model.js";
import { settlePaidOrder } from "../../../shared/utils/settlePaidOrder.js";
import { z } from "zod";

const PLANS = { starter: { amount: 199, interviewCoins: 300 } };
const createOrderSchema = z.object({ planId: z.enum(["starter"]) }).strict();
const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1).max(128),
  razorpay_payment_id: z.string().min(1).max(128),
  razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
}).strict();
const webhookSchema = z.object({ event: z.string() }).passthrough();
const capturedPaymentSchema = z.object({
  order_id: z.string().min(1),
  id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
}).passthrough();

export const createOrder = async (req, res) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid plan" });
    const { planId } = parsed.data;
    const userId = req.headers["x-user-id"];
    const plan = PLANS[planId];
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!plan) return res.status(400).json({ success: false, message: "Invalid plan" });

    const order = await razorpay.orders.create({ amount: plan.amount * 100, currency: "INR", receipt: `receipt_${Date.now()}` });
    await Billing.create({ userId, amount: plan.amount, interviewCoins: plan.interviewCoins, razorpayOrderId: order.id, status: "created" });
    return res.status(201).json({ success: true, order });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Failed to create order" });
  }
};

const creditPaidOrder = async (orderId, paymentId, signature) => {
  return settlePaidOrder({ Billing, User, Ledger: CreditLedger, orderId, paymentId, signature });
};

export const verifyPayment = async (req, res) => {
  try {
    const parsed = verifyPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid payment verification payload" });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;
    const payment = await Billing.findOne({ razorpayOrderId: orderId });
    if (!payment || payment.userId.toString() !== req.headers["x-user-id"]) return res.status(404).json({ success: false, message: "Payment not found" });

    if (!verifyPaymentSignature(orderId, paymentId, signature, process.env.RAZORPAY_KEY_SECRET)) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }
    const result = await creditPaidOrder(orderId, paymentId, signature);
    if (result.user && !result.alreadyProcessed) {
      const sessionId = req.headers["x-session-id"] || req.cookies?.session;
      if (sessionId) await redis.set(`session:${sessionId}`, JSON.stringify({ userId: result.user._id, name: result.user.name, email: result.user.email, interviewCoin: result.user.interviewCoin }), "EX", 60 * 60 * 24 * 7);
    }
    return res.status(200).json({ success: true, message: result.alreadyProcessed ? "Payment already verified" : "Payment successful", ...(result.user ? { interviewCoin: result.user.interviewCoin } : {}) });
  } catch (error) {
    console.error("payment verification failed", error);
    return res.status(500).json({ success: false, message: "Payment verification failed" });
  }
};

export const paymentWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ success: false, message: "Invalid webhook configuration or body" });

  if (!verifyWebhookSignature(req.body, signature, secret)) return res.status(400).json({ success: false, message: "Invalid webhook signature" });

  try {
    let rawEvent;
    try { rawEvent = JSON.parse(req.body.toString("utf8")); }
    catch { return res.status(400).json({ success: false, message: "Invalid webhook payload" }); }
    const parsedEvent = webhookSchema.safeParse(rawEvent);
    if (!parsedEvent.success) return res.status(400).json({ success: false, message: "Invalid webhook payload" });
    const event = parsedEvent.data;
    if (event.event !== "payment.captured") return res.status(200).json({ success: true, ignored: true });
    const parsedPayment = capturedPaymentSchema.safeParse(event.payload?.payment?.entity);
    if (!parsedPayment.success) return res.status(400).json({ success: false, message: "Missing payment details" });
    const entity = parsedPayment.data;
    const order = await Billing.findOne({ razorpayOrderId: entity.order_id });
    if (!order || entity.currency !== "INR" || entity.amount !== order.amount * 100) return res.status(400).json({ success: false, message: "Payment does not match the stored order" });
    await creditPaidOrder(entity.order_id, entity.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("payment webhook failed", error);
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
};
