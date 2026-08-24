import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { CURRENCY_SCHEMA, GOLD_AMOUNT_SCHEMA } from "@/lib/schemas";
import { executeTrade } from "@/services/trading";
import { getLivePrice } from "@/services/price";
import { TradeType } from "@/lib/prisma";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sellSchema = z.object({
  goldAmount: GOLD_AMOUNT_SCHEMA,
  currency: CURRENCY_SCHEMA,
});

/** POST /api/trades/sell — sell gold back to money; cannot sell more than owned. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    await rateLimit(req, { kind: "sensitive", user: authed.user });

    const body = await parseBody(req);
    const parsed = parseOrThrow(sellSchema, body, "sell");

    const price = await getLivePrice(parsed.currency);
    const goldAmount = new Decimal(parsed.goldAmount);
    const result = await executeTrade(
      authed.user.sub,
      TradeType.sell,
      goldAmount,
      new Decimal(price),
      parsed.currency,
    );

    return ok({
      tradeId: result.tradeId,
      type: "sell",
      goldAmount: goldAmount.toFixed(8),
      pricePerGram: result.pricePerGram.toFixed(2),
      currency: parsed.currency,
      totalCost: result.totalCost.toFixed(2),
      goldBalanceAfter: result.goldBalanceAfter.toFixed(8),
      walletBalanceAfter: result.walletBalanceAfter.toFixed(2),
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});