import { NextResponse } from "next/server";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { readPrisma, prisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { NotFoundError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validate";
import { authenticate, requireAdmin } from "@/lib/auth";
import { wrap } from "@/lib/request-context";
import { PRICE_AMOUNT_SCHEMA } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/price — current mock gold price (public). */
export const GET = wrap(async () => {
  try {
    const price = await readPrisma.price.findUnique({ where: { id: "singleton" } });
    if (!price) throw new NotFoundError("Gold price is not configured");

    return ok({
      currency: "USD",
      pricePerGram: price.pricePerGram.toFixed(2),
      updatedAt: price.updatedAt,
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});

const setPriceSchema = z.object({
  currency: z.literal("USD"),
  pricePerGram: PRICE_AMOUNT_SCHEMA,
});

/** POST /api/price — admin override of the mock price. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);
    const body = await req.json().catch(() => ({}));
    const parsed = parseOrThrow(setPriceSchema, body, "price");
    const price = await prisma.price.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", currency: "USD", pricePerGram: parsed.pricePerGram },
      update: { currency: "USD", pricePerGram: parsed.pricePerGram },
    });
    return ok({
      currency: "USD",
      pricePerGram: price.pricePerGram.toFixed(2),
      updatedAt: price.updatedAt,
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});
