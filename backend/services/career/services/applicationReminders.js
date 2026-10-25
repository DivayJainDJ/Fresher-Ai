import { Queue, Worker } from "bullmq";
import Application from "../models/application.model.js";
import ReminderDelivery from "../models/reminderDelivery.model.js";
import User from "../../auth/model/user.model.js";
import { sendReminderEmail } from "./emailProvider.js";

const queueName = "application-reminders";
const connection = () => {
  const url = new URL(process.env.REDIS_URL || "redis://redis:6379");
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null, ...(Number(url.pathname.slice(1)) ? { db: Number(url.pathname.slice(1)) } : {}), ...(url.username ? { username: decodeURIComponent(url.username) } : {}), ...(url.password ? { password: decodeURIComponent(url.password) } : {}), ...(url.protocol === "rediss:" ? { tls: {} } : {}) };
};
let queue;
let worker;

export const sendDueApplicationReminders = async ({ now = new Date() } = {}) => {
  const applications = await Application.find({ nextActionDate: { $ne: "" }, stage: { $ne: "rejected" } }).lean();
  let sent = 0;
  for (const application of applications) {
    const user = await User.findById(application.userId).select("name email timezone reminderEmailsEnabled").lean();
    if (!user?.email || user.reminderEmailsEnabled === false) continue;
    const timezone = user.timezone || "UTC";
    let dueToday;
    try { dueToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
    catch { dueToday = now.toISOString().slice(0, 10); }
    if (application.nextActionDate !== dueToday || application.reminderSentForDate === dueToday) continue;
    let delivery;
    try { [delivery] = await ReminderDelivery.create([{ applicationId: application._id, dueDate: dueToday, status: "sending" }]); }
    catch (error) { if (error.code === 11000) continue; throw error; }
    try {
      const result = await sendReminderEmail({ to: user.email, displayName: user.name, company: application.company, role: application.role, dueDate: dueToday, applicationId: String(application._id) });
      if (result.skipped) {
        await ReminderDelivery.deleteOne({ _id: delivery._id });
        continue;
      }
      await ReminderDelivery.updateOne({ _id: delivery._id }, { $set: { status: "sent", providerId: result.providerId, sentAt: new Date() } });
      await Application.updateOne({ _id: application._id, reminderSentForDate: { $ne: dueToday } }, { $set: { reminderSentForDate: dueToday } });
      sent += 1;
    } catch (error) {
      await ReminderDelivery.updateOne({ _id: delivery._id }, { $set: { status: "failed", error: error.message.slice(0, 500) } });
      console.error(JSON.stringify({ service: "career", event: "application_reminder_failed", applicationId: String(application._id), error: error.message }));
    }
  }
  return sent;
};

export const startApplicationReminderWorker = async () => {
  await Promise.all([Application.init(), ReminderDelivery.init()]);
  queue = new Queue(queueName, { connection: connection() });
  worker = new Worker(queueName, async () => sendDueApplicationReminders(), { connection: connection(), concurrency: 1 });
  worker.on("failed", (job, error) => console.error(JSON.stringify({ service: "career", event: "reminder_job_failed", jobId: job?.id, error: error.message })));
  await queue.upsertJobScheduler("daily-application-reminders", { pattern: "0 0 * * *", tz: "UTC" }, { name: "send-due-reminders", data: {}, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } });
};

export const stopApplicationReminderWorker = async () => {
  await Promise.all([worker?.close(), queue?.close()].filter(Boolean));
};
