import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const CURRENCIES = ["USD", "EUR", "LAK", "THB", "CNY"] as const;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin123!";
  const userEmail = process.env.SEED_USER_EMAIL ?? "user@example.com";
  const userPassword = process.env.SEED_USER_PASSWORD ?? "User123!";

  const admin = await upsertUser(adminEmail, "System Admin", adminPassword, Role.admin);
  const user = await upsertUser(userEmail, "Demo User", userPassword, Role.user);

  // Seed the singleton price row.
  await prisma.price.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", currency: "USD", pricePerGram: Number(process.env.GOLD_PRICE_USD ?? "125.42") },
    update: {},
  });

  console.log(`Seeded admin: ${adminEmail}`);
  console.log(`Seeded user:  ${userEmail}`);
  console.log(`Seeded user id: ${user.id}`);
  console.log(`Seeded admin id: ${admin.id}`);
}

async function upsertUser(email: string, name: string, password: string, role: Role) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
  });
  await prisma.wallet.createMany({
    data: CURRENCIES.map((currency) => ({ userId: user.id, currency, balance: 0 })),
  });
  await prisma.goldHolding.create({ data: { userId: user.id, grams: "0" } });
  return user;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());