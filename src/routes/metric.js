import { Router } from "express";
import prisma from "../PrismaClient.js";
import { fetchAndStoreGoldInr, timeFrame } from "../services/metricServices.js";
import { useLocation } from "react-router-dom";



const router = Router();

// List all active sources
router.get("/sources", async (req, res) => {

  const value = await fetchAndStoreGoldInr();
  const sources = await prisma.metricSource.findMany({
    where: { isActive: true }
  });

  if (!sources) return res.status(404).json({ message: "No data" });
  res.json(sources);
});

//historic data collector
router.get('/timeframe', async (req, res) => {
  const { start_date, end_date } = req.query;

  const result = await timeFrame(start_date, end_date);
  // if (!result.ok) return res.status(500).json(result.error);

  res.json({
    start: start_date,
    end: end_date,
    data: result?.data
  });
});


//get the gold price
router.get('/:metal', async (req, res) => {
  const name = req.params.metal
  if (name == 'gold' || name == 'silver') {
    const sources = await prisma.metricSource.findMany({
      where: { isActive: true }
    })


    if (!sources) return res.status(404).json({ message: "No data" });
    // build midnight in UTC for today (safe for Prisma)
    const today = new Date(); // or use a specific date string
    const yyyy = today.getUTCFullYear();
    const mm = today.getUTCMonth(); // monthIndex 0..11
    const dd = today.getUTCDate();

    const startOfDayUTC = new Date(Date.UTC(yyyy, mm, dd, 0, 0, 0)); // 00:00:00 UTC

    const found = await prisma.metricValue.findFirst({
      where: { recordedAt: startOfDayUTC } // exact timestamp match
    });

    res.json(found);

  }
  else {
    res.status(404).json({ message: "Metal name is incorrect " });
  }
})

// Latest value for a metric
router.get("/:id/latest", async (req, res) => {

  const id = Number(req.params.id);
  const latest = await prisma.metricValue.findFirst({
    where: { metricSourceId: id },
    orderBy: { recordedAt: "desc" }
  });

  if (!latest) return res.status(404).json({ message: "No data" });
  res.json(latest);
});

router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);

  const values = await prisma.metricValue.findMany({
    where: { metricSourceId: id },
    orderBy: { recordedAt: "asc" },
    take: 500
  });

  res.json(values);
});


export default router;
