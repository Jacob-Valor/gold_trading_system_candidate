import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { simulatedDepositsEnabled } from "@/lib/config";
import { ForbiddenError } from "@/lib/errors";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { CURRENCY_SCHEMA, AMOUNT_SCHEMA } from "@/lib/schemas";
import { applyMoneyDelta } from "@/services/wallet";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const depositSchema = z.object({
  amount: AMOUNT_SCHEMA,
  currency: CURRENCY_SCHEMA,
});

/** POST /api/wallet/deposit — simulate a deposit into the user's wallet. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    if (!simulatedDepositsEnabled()) {
      throw new ForbiddenError("Simulated deposits are disabled in this environment");
    }
    await rateLimit(req, { kind: "sensitive", user: authed.user });

    const body = await parseBody(req);
    const parsed = parseOrThrow(depositSchema, body, "deposit");

    const { walletId, balanceAfter } = await applyMoneyDelta(
      authed.user.sub,
      parsed.currency,
      new Decimal(parsed.amount),
      "Deposit",
    );

    return ok({ walletId, balanceAfter: balanceAfter.toFixed(2) }, { status: 201 });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});