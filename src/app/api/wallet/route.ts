import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { readPrisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { wrap, type Context } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/wallet — multi-currency balances + gold holding. */
export const GET = wrap(async (req: NextRequest, _ctx: Context) => {
  try {
    const authed = await authenticate(req);

    const [wallets, gold] = await Promise.all([
      readPrisma.wallet.findMany({
        where: { userId: authed.user.sub },
        select: { currency: true, balance: true },
      }),
      readPrisma.goldHolding.findUnique({
        where: { userId: authed.user.sub },
        select: { grams: true },
      }),
    ]);

    return ok({
      wallets: wallets.map((wallet) => ({
        currency: wallet.currency,
        balance: wallet.balance.toFixed(2),
      })),
      goldGrams: gold?.grams.toFixed(8) ?? "0.00000000",
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});