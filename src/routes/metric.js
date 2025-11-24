import { Router } from "express";
import { prisma } from "../index.js";
import { fetchAndStoreGoldInr } from "../services/metricServices.js";


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

// Latest value for a metric
router.get("/:id/latest", async (req, res) => {
    console.log("params",req)

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
