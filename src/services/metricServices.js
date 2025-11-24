import { env } from "process";
import { prisma } from "../index.js";
import axios from "axios";

export async function fetchAndStoreGoldInr() {

  // https://api.metalpriceapi.com/v1/2025-11-14?api_key=008b524c3475010dfdc93194e9cc7737&base=inr&currencies=XAU

  const apiKey = process.env.METAL_API_KEY;

  if (!apiKey) {
    console.error("METALS_API_KEY missing in .env");
    return;
  }

  const response = await axios.get(process.env.METAL_API + 'latest', {
    params: {
      api_key: apiKey,
      base: "INR",  
      currencies: "XAU"
    }
  });

  
  
  
  const price = Math.round(response.data.rates.INRXAU/3);

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
