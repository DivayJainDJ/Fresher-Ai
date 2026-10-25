export const ensureOpeningLedger = async ({ User, Ledger, userId, session }) => {
  const prior = await Ledger.findOne({ userId }).session(session);
  if (prior) return prior;
  const user = await User.findById(userId, null, { session });
  if (!user) return null;
  await Ledger.create([{
    userId,
    amount: Number.isFinite(user.interviewCoin) ? user.interviewCoin : 0,
    type: "opening",
    eventKey: `opening:${userId}`,
  }], { session });
  return user;
};
