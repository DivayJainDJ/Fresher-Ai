const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export const sendReminderEmail = async ({ to, displayName, company, role, dueDate, applicationId }) => {
  const provider = process.env.EMAIL_PROVIDER || "none";
  if (provider === "none") return { skipped: true, reason: "Email provider is not configured" };
  if (provider !== "resend") throw new Error(`Unsupported email provider: ${provider}`);
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error("RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend");
  const subject = `Follow up: ${company} — ${role}`;
  const html = `<p>Hello ${escapeHtml(displayName || "there")},</p><p>Your next action for <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> is due today (${escapeHtml(dueDate)}).</p><p>Open your FresherAI job tracker and take the next step.</p>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `application-reminder:${applicationId}:${dueDate}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email provider ${response.status}: ${result.message || "send failed"}`);
  return { providerId: result.id || "" };
};
