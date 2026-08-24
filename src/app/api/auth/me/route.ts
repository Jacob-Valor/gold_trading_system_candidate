import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { readPrisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — current user profile + balances + gold holding. */
export const GET = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);

    const user = await readPrisma.user.findUnique({
      where: { id: authed.user.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        wallets: { select: { currency: true, balance: true } },
        goldHoldings: { select: { grams: true } },
      },
    });
    if (!user) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        { status: 404 },
      );
    }

    return ok({
      ...user,
      wallets: user.wallets.map((wallet) => ({
        ...wallet,
        balance: wallet.balance.toFixed(2),
      })),
      goldHoldings: user.goldHoldings.map((holding) => ({
        ...holding,
        grams: holding.grams.toFixed(8),
      })),
      bankBalanceUsd:
        user.wallets.find((wallet) => wallet.currency === "USD")?.balance.toFixed(2) ?? "0.00",
      goldGrams: user.goldHoldings[0]?.grams.toFixed(8) ?? "0.00000000",
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});