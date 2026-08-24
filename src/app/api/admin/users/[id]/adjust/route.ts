import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate, requireAdmin } from "@/lib/auth";
import { TransactionType, withTransactionRetry } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { CURRENCY_SCHEMA, SIGNED_AMOUNT_SCHEMA } from "@/lib/schemas";
import { changeWalletBalance } from "@/services/wallet";
import { wrap, type Context } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const adjustSchema = z.object({
  amount: SIGNED_AMOUNT_SCHEMA, // negative debits and positive credits
  currency: CURRENCY_SCHEMA,
  reason: z.string().min(3).max(255),
});

/** POST /api/admin/users/[id]/adjust — adjust a user's wallet balance (admin override). */
export const POST = wrap(async (req: NextRequest, ctx: Context) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const { id } = await ctx.params;
    const body = await parseBody(req);
    const parsed = parseOrThrow(adjustSchema, body, "adjust");

    const result = await withTransactionRetry(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new Error("USER_NOT_FOUND");
      const { walletId, balanceAfter } = await changeWalletBalance(
        tx,
        id,
        parsed.currency,
        new Decimal(parsed.amount),
        `Admin adjustment: ${parsed.reason}`,
        TransactionType.adjustment,
      );
      await tx.adjustment.create({
        data: {
          userId: authed.user.sub,
          walletId,
          amount: new Decimal(parsed.amount).toFixed(2),
          reason: parsed.reason,
        },
      });
      return { walletId, balanceAfter };
    });

    return ok({ walletId: result.walletId, balanceAfter: result.balanceAfter.toFixed(2) });
  } catch (e) {
    if (e instanceof Error && e.message === "USER_NOT_FOUND") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        { status: 404 },
      );
    }
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});