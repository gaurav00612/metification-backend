import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import PrismaClient from "./PrismaClient.js";
import cron from "node-cron";
import metricRoutes from "./routes/metric.js";


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/test/add-metric", async (req, res) => {
  const price = await fetchAndStoreGoldInr();
  res.json({ addedPrice: price });
});

app.use("/metrics", metricRoutes);
// app.use("/alerts", alertRoutes);

// cron.schedule("*/5 * * * *", async () => {
// console.error("Running metrics + alerts job");
// //   await processMetricsAndAlerts();
// });

import "./scheduler/dailyAlert.js";


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.error(`Server running on port ${PORT}`);
});
