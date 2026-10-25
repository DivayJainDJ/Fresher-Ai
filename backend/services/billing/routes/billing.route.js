import express from "express"
import { createOrder, verifyPayment, paymentWebhook } from "../controllers/billing.controller.js"
import { isAuth } from "../middleware/isAuth.js"

const billingRouter = express.Router()


billingRouter.post("/create", isAuth, createOrder)
billingRouter.post("/verify", isAuth, verifyPayment)
billingRouter.post("/webhook", (req, _res, next) => { req.body = req.rawBody; next() }, paymentWebhook)

export default billingRouter
