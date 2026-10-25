import { ensureOpeningLedger } from "./ensureOpeningLedger.js";

export const settlePaidOrder = async ({ Billing, User, Ledger, orderId, paymentId, signature, sessionFactory = () => Billing.startSession() }) => {
  const session = await sessionFactory();
  let result = { alreadyProcessed: false };
  try {
    await session.withTransaction(async () => {
      const claimed = await Billing.findOneAndUpdate(
        { razorpayOrderId: orderId, status: "created" },
        { $set: { status: "paid", razorpayPaymentId: paymentId, ...(signature ? { razorpaySignature: signature } : {}) } },
        { new: true, session }
      );
      if (!claimed) {
        result = { alreadyProcessed: true };
        return;
      }

      const openingUser = await ensureOpeningLedger({ User, Ledger, userId: claimed.userId, session });
      if (!openingUser) throw new Error("User not found while crediting payment");
      const user = await User.findByIdAndUpdate(claimed.userId, { $inc: { interviewCoin: claimed.interviewCoins } }, { new: true, session });
      if (!user) throw new Error("User not found while crediting payment");
      await Ledger.create([{
        userId: claimed.userId,
        amount: claimed.interviewCoins,
        type: "purchase",
        billingId: claimed._id,
        razorpayPaymentId: paymentId,
        eventKey: `billing:${claimed._id}`,
      }], { session });
      result = { user, coins: claimed.interviewCoins };
    });
    return result;
  } finally {
    await session.endSession();
  }
};
