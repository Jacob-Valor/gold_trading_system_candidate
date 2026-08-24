import bcrypt from "bcryptjs";

import { CURRENCIES } from "@/lib/currencies";
import { ConflictError } from "@/lib/errors";
import { Prisma, withTransactionRetry } from "@/lib/prisma";

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role?: "user" | "admin";
};

export async function createUser({ name, email, password, role = "user" }: CreateUserInput) {
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    return await withTransactionRetry(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash, role },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      await tx.wallet.createMany({
        data: CURRENCIES.map((currency) => ({ userId: user.id, currency, balance: 0 })),
      });
      await tx.goldHolding.create({ data: { userId: user.id, grams: "0" } });

      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Email already registered");
    }
    throw error;
  }
}