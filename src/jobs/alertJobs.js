import { prisma } from "../index";
import { fetchAndStoreGoldInr } from "../services/metricsService";
import { sendEmailNotification } from "../services/notificationService";

export async function processMetricsAndAlerts() {
  // 1. Fetch & store latest metric(s)
  await fetchAndStoreGoldInr();

  // 2. Get all active alerts
  const alerts = await prisma.alertRule.findMany({
    where: { isActive: true },
    include: { metricSource: true }
  });

  for (const alert of alerts) {
    const latestValue = await prisma.metricValue.findFirst({
      where: { metricSourceId: alert.metricSourceId },
      orderBy: { recordedAt: "desc" }
    });

    if (!latestValue) continue;

    const v = latestValue.value;
    const th = alert.thresholdValue;

    const triggered =
      (alert.conditionType === "greater_than" && v > th) ||
      (alert.conditionType === "less_than" && v < th);

    if (!triggered) continue;

    const msg = `Alert: ${alert.metricSource.name} is ${v} (rule: ${alert.conditionType} ${th})`;

    try {
      await sendEmailNotification(alert.email, "Price Alert Triggered", msg);

      await prisma.notificationLog.create({
        data: {
          alertRuleId: alert.id,
          sentVia: "email",
          status: "success",
          message: msg
        }
      });
    } catch (e) {
      await prisma.notificationLog.create({
        data: {
          alertRuleId: alert.id,
          sentVia: "email",
          status: "failed",
          message: msg
        }
      });
    }
  }
}
