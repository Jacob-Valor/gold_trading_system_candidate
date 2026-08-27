import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const target = process.argv[2];
if (!target || !process.env.DATABASE_URL) {
  throw new Error(
    "Usage: tsx scripts/cleanup-test-data.ts <test-email|--all> with DATABASE_URL configured",
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    if (target === "--all") {
      await prisma.broadcast.deleteMany({
        where: { title: { startsWith: "Integration broadcast" } },
      });
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { endsWith: "@example.test" } },
            { email: { startsWith: "smoke-" } },
            { email: { startsWith: "caseuser-" } },
          ],
        },
      });
    } else {
      await prisma.user.deleteMany({ where: { email: target } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
