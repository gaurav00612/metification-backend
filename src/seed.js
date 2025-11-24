import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.metricSource.upsert({
    where: { code: "GOLD_INR" },
    update: {},
    create: {
      name: "Gold Price in INR",
      code: "GOLD_INR"
    }
  });
}

main().finally(() => prisma.$disconnect());
