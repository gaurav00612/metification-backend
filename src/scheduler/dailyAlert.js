// ./scheduler/dailyAlert.js (drop-in test/debug version)
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import PrismaClient from "../PrismaClient.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.warn("[dailyAlert] TELEGRAM_BOT_TOKEN not set. Telegram alerts disabled.");
} else {
    console.log("[dailyAlert] TELEGRAM_BOT_TOKEN found (length)", token.length);

    const bot = new TelegramBot(token, { polling: true });
    bot.on("polling_error", (err) => console.error("[dailyAlert] polling error:", err));

    // quick helper - IST day range -> UTC start/end
    function istDayRange(date = new Date()) {
        const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const year = istDate.getFullYear(), month = istDate.getMonth(), day = istDate.getDate();
        return {
            startUTC: new Date(Date.UTC(year, month, day, 0, 0, 0)),
            endUTC: new Date(Date.UTC(year, month, day + 1, 0, 0, 0)),
        };
    }

    async function lastMetricValueInRange(start, end) {
        return PrismaClient.metricValue.findFirst({
            where: { recordedAt: { gte: start, lt: end } },
            orderBy: { recordedAt: "desc" },
        });
    }

    async function computeDailyChangeForToday() {
        const today = new Date();
        const { startUTC: todayStart, endUTC: todayEnd } = istDayRange(today);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const { startUTC: yStart, endUTC: yEnd } = istDayRange(yesterday);

        const yesterdayVal = await lastMetricValueInRange(yStart, yEnd);
        const todayVal = await lastMetricValueInRange(todayStart, todayEnd);
        if (!yesterdayVal || !todayVal) return null;
        const change = todayVal.value - yesterdayVal.value;
        const pct = (change / yesterdayVal.value) * 100;
        return { yesterday: yesterdayVal.value, today: todayVal.value, change, pct, todayAt: todayVal.recordedAt };
    }

    async function sendReportToChat(chatId, report) {
        if (!report) {
            await bot.sendMessage(chatId, "⚠️ No price data available for today or yesterday.");
            return;
        }
        const text = `📊 Gold Price — Daily Update (IST)\n\nYesterday: ₹${report.yesterday}\nToday:     ₹${report.today}\n\nChange: ₹${report.change.toFixed(2)} (${report.pct.toFixed(2)}%)\nRecorded at (IST): ${new Date(report.todayAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
        await bot.sendMessage(chatId, text);
    }

    // one-time immediate check so you see something on server start
    (async () => {
        try {
            console.log("[dailyAlert] running startup self-check...");
            const subs = await PrismaClient?.telegramSubscriber?.findMany();
            console.log(`[dailyAlert] subscribers on startup: ${subs?.length}`);
            // do not spam users on startup — only log. If you want to send on startup, uncomment:
            // const report = await computeDailyChangeForToday();
            // for (const s of subs) await sendReportToChat(s.chatId, report);
        } catch (e) {
            console.error("[dailyAlert] startup check failed:", e);
        }
    })();

    // TEMP: schedule every minute for testing (change back to daily later)
    const cronExpr = "*/1 * * * *";
    console.error("[dailyAlert] scheduling cron:", cronExpr, "timezone Asia/Kolkata");
    cron.schedule(
        cronExpr,
        async () => {
            console.log("[dailyAlert] cron fired at", new Date().toISOString());
            try {
                const report = await computeDailyChangeForToday();
                const subs = await PrismaClient.telegramSubscriber.findMany();
                console.log(`[dailyAlert] found ${subs.length} subs, report present: ${Boolean(report)}`);
                if (subs.length > 0) {
                    for (const s of subs) {
                        try {
                            await sendReportToChat(s.chatId, report);
                            console.log("[dailyAlert] sent to", s.chatId);
                        } catch (err) {
                            console.error("[dailyAlert] send failed to", s.chatId, err?.response || err);
                        }
                    }
                }
                else {
                    console.error("No subs found")
                }

            } catch (e) {
                console.error("[dailyAlert] cron job error:", e);
            }
        },
        { timezone: "Asia/Kolkata" }
    );

    // basic bot commands
    bot.onText(/\/start/, async (msg) => {
        const chatId = String(msg.chat.id);
        const name = msg.from?.first_name ?? null;
        try {
            await PrismaClient.telegramSubscriber.upsert({ where: { chatId }, update: { name }, create: { chatId, name } });
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
            await sendReportToChat(chatId, report);
            console.log("[dailyAlert] /now reply to", chatId);
        } catch (err) {
            console.error("[dailyAlert] /now error:", err);
            await bot.sendMessage(chatId, "Failed to fetch report.");
        }
    });

    bot.onText(/\/stop/, async (msg) => {
        const chatId = String(msg.chat.id);
        try {
            await PrismaClient.telegramSubscriber.deleteMany({ where: { chatId } });
            await bot.sendMessage(chatId, "Unsubscribed.");
            console.log("[dailyAlert] /stop from", chatId);
        } catch (err) {
            console.error("[dailyAlert] /stop error:", err);
        }
    });

    process.on("SIGINT", () => { bot.stopPolling(); console.log("[dailyAlert] bot stopped SIGINT"); });
    process.on("SIGTERM", () => { bot.stopPolling(); console.log("[dailyAlert] bot stopped SIGTERM"); });

    console.error("[dailyAlert] started successfully");
}
