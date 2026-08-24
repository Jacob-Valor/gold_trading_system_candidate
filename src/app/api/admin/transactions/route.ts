import { NextResponse } from "next/server";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { okPaged } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow } from "@/lib/validate";
import { TYPE_SCHEMA, DATE_SCHEMA, CURRENCY_SCHEMA } from "@/lib/schemas";
import { Prisma } from "@/lib/prisma";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: TYPE_SCHEMA.optional(),
  currency: CURRENCY_SCHEMA.optional(),
  from: DATE_SCHEMA.optional(),
  to: DATE_SCHEMA.optional(),
  userName: z.string().max(100).optional(),
});

/** GET /api/admin/transactions — all transactions; search by user name, type, date range; paginated. */
export const GET = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const { searchParams } = new URL(req.url);
    const parsed = parseOrThrow(querySchema, Object.fromEntries(searchParams), "query");
    const page = parsed.page ?? 1;
    const pageSize = parsed.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.TransactionWhereInput = {};
    if (parsed.type) where.type = parsed.type;
    if (parsed.currency) where.currency = parsed.currency;
    if (parsed.userName) {
      where.user = { name: { contains: parsed.userName, mode: "insensitive" } };
    }
    if (parsed.from || parsed.to) {
      where.createdAt = {
        ...(parsed.from ? { gte: new Date(parsed.from) } : {}),
        ...(parsed.to ? { lte: new Date(parsed.to) } : {}),
      };
    }

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          userId: true,
          type: true,
          amount: true,
          currency: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    return okPaged(
      transactions.map((transaction) => ({
        ...transaction,
        amount: transaction.amount.toFixed(2),
        balanceAfter: transaction.balanceAfter.toFixed(2),
      })),
      { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNext: page * pageSize < total, hasPrevious: page > 1 },
    );
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});