import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import PrismaClient from "./PrismaClient.js";

const prisma = new PrismaClient();
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");

const bot = new TelegramBot(token, { polling: true });

// Helpers: create start/end of day UTC from an IST date
function startEndOfDateIST(date) {
  // date is a Date or 'YYYY-MM-DD' string in IST
  // We'll construct using UTC offsets to avoid DST issues by building using IST parts
  const d = (typeof date === "string") ? new Date(date) : new Date(date);

  // compute IST date parts by shifting to +05:30
  // getUTC* then add 5.5 hours
  const utcYear = d.getUTCFullYear();
  const utcMonth = d.getUTCMonth();
  const utcDate = d.getUTCDate();

  // Simpler: create a Date in IST by using locale string parts
  const iso = new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });
  // iso looks like "26/11/2025, 12:00:00 PM" — parse manually is more complex.
  // Instead, use this approach: get IST date by adding offset
  const istOffset = 5.5 * 60; // minutes
  const t = new Date(d.getTime() + istOffset * 60 * 1000); // shift to IST
  const year = t.getUTCFullYear(), month = t.getUTCMonth(), day = t.getUTCDate();

  const start = new Date(Date.UTC(year, month, day, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0));
  return { start, end };
}

// Compute percent change between yesterday and today (based on closing price or last recorded value)
async function computeDailyChangeForDate(date = new Date()) {
  // date is reference date in IST
  // Build start/end of 'date' and yesterday in UTC ranges
  const { start: todayStart, end: todayEnd } = startEndOfDateIST(date);
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const { start: yStart, end: yEnd } = startEndOfDateIST(yesterday);

  // Get last recorded value for yesterday and today
  const yesterdayVal = await prisma.metricValue.findFirst({
    where: { recordedAt: { gte: yStart, lt: yEnd } },
    orderBy: { recordedAt: "desc" },
  });

  const todayVal = await prisma.metricValue.findFirst({
    where: { recordedAt: { gte: todayStart, lt: todayEnd } },
    orderBy: { recordedAt: "desc" },
  });

  if (!yesterdayVal || !todayVal) return null;

  const change = todayVal.value - yesterdayVal.value;
  const pct = ((change) / yesterdayVal.value) * 100;
  return {
    yesterday: yesterdayVal.value,
    today: todayVal.value,
    change,
    pct,
    yesterdayAt: yesterdayVal.recordedAt,
    todayAt: todayVal.recordedAt,
  };
}

// Send message to a chat
async function sendDailyMessageToChat(chatId, report) {
  const msg = report
    ? `📈 Daily price update (IST)

Yesterday: ₹${report.yesterday.toFixed(2)}
Today:     ₹${report.today.toFixed(2)}

Change: ₹${report.change.toFixed(2)} (${report.pct.toFixed(2)}%)
Recorded at: ${new Date(report.todayAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
    : "⚠️ No price data available for today or yesterday.";

  try {
    await bot.sendMessage(chatId, msg);
  } catch (err) {
    console.error("Failed send message to", chatId, err);
  }
}

// Schedule daily job at configured hour in IST
const hour = Number(process.env.DAILY_ALERT_HOUR ?? 7); // 7 AM IST by default
// cron expression: minute hour * * * . we'll run at 07:00 IST
// node-cron supports timezone option
cron.schedule(
  `0 ${hour} * * *`,
  async () => {
    try {
      console.log("Running daily alert job", new Date().toISOString());
      const report = await computeDailyChangeForDate(new Date());
      const subs = await prisma.telegramSubscriber.findMany();
      for (const s of subs) {
        await sendDailyMessageToChat(s.chatId, report);
      }
    } catch (e) {
      console.error("Daily alert job failed", e);
    }
  },
  {
    scheduled: true,
    timezone: "Asia/Kolkata",
  }
);

// Handle basic commands to subscribe/unsubscribe
bot.onText(/\/start/, async (msg) => {
  const chatId = String(msg.chat.id);
  const name = msg.from?.first_name ?? null;
  try {
    await prisma.telegramSubscriber.upsert({
      where: { chatId },
      update: { name },
      create: { chatId, name },
    });
    await bot.sendMessage(chatId, `Subscribed to daily price alerts at ${hour}:00 IST. Use /stop to unsubscribe.`);
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "Subscription failed. Contact admin.");
  }
});

bot.onText(/\/stop/, async (msg) => {
  const chatId = String(msg.chat.id);
  try {
    await prisma.telegramSubscriber.deleteMany({ where: { chatId }});
    await bot.sendMessage(chatId, "Unsubscribed from daily alerts.");
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "Unsubscribe failed.");
  }
});

// Optional: manual trigger for testing
bot.onText(/\/now/, async (msg) => {
  const chatId = String(msg.chat.id);
  const report = await computeDailyChangeForDate(new Date());
  await sendDailyMessageToChat(chatId, report);
});

export default bot;
