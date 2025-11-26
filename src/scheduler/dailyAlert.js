// src/scheduler/dailyAlert.js
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import axios from "axios";
import prisma from "../PrismaClient.js"; 

const token = process.env.TELEGRAM_BOT_TOKEN;
const enablePolling = process.env.TELEGRAM_POLLING === "true"; // set true in .env for dev

console.log("[dailyAlert] module loaded. polling enabled:", enablePolling);

async function clearWebhookIfAny() {
  if (!token) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`);
    console.log("[telegram] webhook removed (if any)");
  } catch (err) {
    console.warn("[telegram] deleteWebhook failed:", err?.response?.data || err.message);
  }
}

// Helper: IST day -> UTC start/end
function istDayRange(date = new Date()) {
  const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const year = istDate.getFullYear(), month = istDate.getMonth(), day = istDate.getDate();
  return {
    startUTC: new Date(Date.UTC(year, month, day, 0, 0, 0)),
    endUTC: new Date(Date.UTC(year, month, day + 1, 0, 0, 0)),
  };
}

async function lastMetricValueInRange(start, end) {
  return prisma.metricValue.findFirst({
    where: { recordedAt: { gte: start, lt: end } },
    orderBy: { recordedAt: "desc" },
  });
}

async function computeDailyChangeForToday() {
  const today = new Date();
  const { startUTC: todayStart, endUTC: todayEnd } = istDayRange(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const { startUTC: yStart, endUTC: yEnd } = istDayRange(yesterday);

  const yesterdayVal = await lastMetricValueInRange(yStart, yEnd);
  const todayVal = await lastMetricValueInRange(todayStart, todayEnd);
  if (!yesterdayVal || !todayVal) return null;
  const change = todayVal.value - yesterdayVal.value;
  const pct = (change / yesterdayVal.value) * 100;
  return { yesterday: yesterdayVal.value, today: todayVal.value, change, pct, todayAt: todayVal.recordedAt };
}

function buildReportText(report) {
  if (!report) return "⚠️ No price data available for today or yesterday.";
  return `📊 Gold Price — Daily Update (IST)

Yesterday: ₹${report.yesterday.toFixed(2)}
Today:     ₹${report.today.toFixed(2)}

Change: ₹${report.change.toFixed(2)} (${report.pct.toFixed(2)}%)

Recorded at (IST): ${new Date(report.todayAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
}

// Initialization IIFE
(async function initTelegramAndCron() {
  if (!token) {
    console.warn("[dailyAlert] TELEGRAM_BOT_TOKEN not set. Telegram alerts disabled.");
    return;
  }

  if (!enablePolling) {
    console.log("[dailyAlert] Telegram polling disabled (TELEGRAM_POLLING != true).");
  }

  // If polling enabled, ensure no webhook blocks us and then create bot
  let bot = null;
  if (enablePolling) {
    await clearWebhookIfAny();
    bot = new TelegramBot(token, { polling: true });
    bot.on("polling_error", (err) => console.error("[dailyAlert] polling error:", err?.response || err?.message || err));
    console.log("[dailyAlert] Telegram bot polling started.");
  }

  // startup self-check (non-spam): log subscriber count
  try {
    const subs = await prisma.telegramSubscriber.findMany();
    console.log(`[dailyAlert] subscribers on startup: ${subs?.length ?? 0}`);
  } catch (e) {
    console.error("[dailyAlert] startup check failed:", e);
  }

  // Cron expression from env or default (07:00 IST)
  // If you want 05:30 set ALERT_TIME=05:30 in .env
  const [hourStr, minStr] = (process.env.ALERT_TIME ?? "07:00").split(":");
  const cronExpr = `${Number(minStr)} ${Number(hourStr)} * * *`; // minute hour * * *
  console.log("[dailyAlert] scheduling cron:", cronExpr, "timezone Asia/Kolkata");

  cron.schedule(
    cronExpr,
    async () => {
      console.log("[dailyAlert] cron fired at", new Date().toISOString());
      try {
        const report = await computeDailyChangeForToday();
        const subs = await prisma.telegramSubscriber.findMany();
        console.log(`[dailyAlert] found ${subs.length} subs, report present: ${Boolean(report)}`);
        for (const s of subs) {
          try {
            if (bot) await bot.sendMessage(s.chatId, buildReportText(report));
            else {
              console.log("[dailyAlert] bot polling disabled, skipping send to", s.chatId);
            }
          } catch (err) {
            console.error("[dailyAlert] send failed to", s.chatId, err?.response || err);
          }
        }
      } catch (e) {
        console.error("[dailyAlert] cron job error:", e);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Bot command handlers (only if polling is enabled)
  if (bot) {
    bot.onText(/\/start/, async (msg) => {
      const chatId = String(msg.chat.id);
      const name = msg.from?.first_name ?? null;
      try {
        await prisma.telegramSubscriber.upsert({ where: { chatId }, update: { name }, create: { chatId, name } });
        await bot.sendMessage(chatId, "Subscribed. Send /now to get instant update.");
        console.log("[dailyAlert] /start from", chatId);
      } catch (err) {
        console.error("[dailyAlert] /start error:", err);
      }
    });

    bot.onText(/\/now/, async (msg) => {
      const chatId = String(msg.chat.id);
      try {
        const report = await computeDailyChangeForToday();
        await bot.sendMessage(chatId, buildReportText(report));
        console.log("[dailyAlert] /now reply to", chatId);
      } catch (err) {
        console.error("[dailyAlert] /now error:", err);
        await bot.sendMessage(chatId, "Failed to fetch report.");
      }
    });

    bot.onText(/\/stop/, async (msg) => {
      const chatId = String(msg.chat.id);
      try {
        await prisma.telegramSubscriber.deleteMany({ where: { chatId } });
        await bot.sendMessage(chatId, "Unsubscribed.");
        console.log("[dailyAlert] /stop from", chatId);
      } catch (err) {
        console.error("[dailyAlert] /stop error:", err);
      }
    });

    // graceful polling stop
    process.on("SIGINT", () => { bot.stopPolling(); console.log("[dailyAlert] bot stopped SIGINT"); });
    process.on("SIGTERM", () => { bot.stopPolling(); console.log("[dailyAlert] bot stopped SIGTERM"); });
  }
})();
