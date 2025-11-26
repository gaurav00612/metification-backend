import { env } from "process";
import { prisma } from "../index.js";
import axios from "axios";
import { parseGoldTimeframe } from "./Parsers/goldParser.js";

const apiKey = process.env.METAL_API_KEY;


export async function fetchAndStoreGoldInr() {

  if (!apiKey) {
    console.error("METALS_API_KEY missing in .env");
    return;
  }

  const url = `${process.env.METAL_API.replace(/\/+$/, '')}/latest`;

  const response = await axios.get(url, {
    params: {
      api_key: apiKey,
      base: "INR",
      currencies: "XAU"
    }
  });

  const ouncePriceInInr = Number(response.data.rates.XAU);

  const price = Math.round(ouncePriceInInr * (10 / 31.1034768));

  const source = await prisma.metricSource.findFirst({
    where: { code: "GOLD_INR", isActive: true }
  });

  if (!source) return;

  await prisma.metricValue.create({
    data: {
      metricSourceId: source.id,
      value: price
    }
  });

  return price;
}


//historic data of gold
// Assumes: parseGoldTimeframe(apiData) => [{ date, ounceINR, tenGramINR }, ...]
//          TEN_GRAM_FACTOR if you need to compute
//          prisma and axios already imported, API_KEY/API_BASE present

export async function timeFrame(startDate, endDate, { storeToDb = true } = {}) {
  if (!apiKey) {
    console.error("METAL_API_KEY missing");
    return { ok: false, error: "METAL_API_KEY missing" };
  }
  if (!startDate || !endDate) return { ok: false, error: "startDate and endDate required" };

  // Parse incoming dates and build date array for check
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end) || start > end) return { ok: false, error: "invalid date range" };

  // Build list of date strings 'YYYY-MM-DD' inclusive
  const yyyyMmDd = (d) => d.toISOString().slice(0, 10);
  const neededDates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    neededDates.push(yyyyMmDd(new Date(d)));
  }

  // find source
  const source = await prisma.metricSource.findFirst({
    where: { code: "GOLD_INR", isActive: true }
  });
  if (!source) return { ok: false, error: "metric source missing" };

  // Query DB for existing rows in range (assumes recordedAt stored as Date)
  const existing = await prisma.metricValue.findMany({
    where: {
      metricSourceId: source.id,
      recordedAt: {
        gte: new Date(startDate + 'T00:00:00Z'),
        lte: new Date(endDate + 'T23:59:59Z')
      }
    },
    orderBy: { recordedAt: 'asc' }
  });

  // Map existing to a date->row map for quick lookup
  const existingMap = new Map();
  for (const r of existing) {
    const key = r.recordedAt.toISOString().slice(0, 10);
    existingMap.set(key, {
      date: key,
      ounceINR: r.ouncePrice ?? null, 
      tenGramINR: Number(r.value),
      raw: r
    });
  }

  // Check if all dates are present
  const missingDates = neededDates.filter(d => !existingMap.has(d));

  if (missingDates.length === 0) {
    // All present — return sorted array from DB
    const result = neededDates.map(d => existingMap.get(d));
    return { ok: true, data: result, source: 'db' };
  }

  // Some dates missing → call external API (request full timeframe for simplicity)
  try {
    const url = `${process.env.METAL_API.replace(/\/+$/, '')}/timeframe`;
    const res = await axios.get(url, {
      params: {
        api_key: apiKey,
        start_date: startDate,
        end_date: endDate,
        base: "INR",
        currencies: "XAU"
      },
      timeout: 20000
    });

    const parsed = parseGoldTimeframe(res.data); // returns [{date, ounceINR, tenGramINR},...]

    // Merge parsed into existingMap
    for (const p of parsed) {
      existingMap.set(p.date, { date: p.date, ounceINR: p.ounceINR, tenGramINR: p.tenGramINR });
    }

    // Optionally store to DB only the missing ones
    if (storeToDb && parsed.length > 0) {
      // Prepare createMany data for parsed rows that are missing in DB
      const toInsert = parsed
        .filter(p => !existing.find(r => r.recordedAt.toISOString().slice(0, 10) === p.date))
        .map(p => ({
          metricSourceId: source.id,
          value: Number(p.tenGramINR),
          recordedAt: new Date(p.date + 'T00:00:00Z'),
          base: 'INR',
          currency: 'XAU'
          // optionally store ouncePrice: p.ounceINR if schema has field
        }));

      if (toInsert.length > 0) {
        // Prefer createMany for speed. If you want to avoid duplicates, ensure unique constraint
        try {
          await prisma.metricValue.createMany({
            data: toInsert,
            skipDuplicates: true // requires unique constraint to work
          });
        } catch (e) {
          // fallback to per-row create if createMany fails (e.g., no unique constraint)
          for (const row of toInsert) {
            await prisma.metricValue.create({ data: row });
          }
        }
      }
    }

    // Build final ordered result array
    const final = neededDates.map(d => existingMap.get(d)).filter(Boolean);

    return { ok: true, data: final, source: 'api+db' };
  } catch (err) {
    console.error("timeFrame API error:", err.response?.data || err.message || err);
    const fallback = neededDates.map(d => existingMap.get(d)).filter(Boolean);
    return { ok: false, error: err.response?.data || err.message, data: fallback };
  }
}

