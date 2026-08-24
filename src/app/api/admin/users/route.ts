import { NextResponse } from "next/server";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, okPaged } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { getPagination, buildPagination } from "@/lib/pagination";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { Prisma } from "@/lib/prisma";
import { createUser } from "@/services/user";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(255),
  password: z.string().min(8).max(100),
  role: z.enum(["user", "admin"]).optional(),
});

/** GET /api/admin/users — list all users with balances + gold, search/filter, paginated. */
export const GET = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const { searchParams } = new URL(req.url);
    const { page, pageSize, skip, take } = getPagination(searchParams);
    const where = buildUserWhere(searchParams);

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          deletedAt: true,
          createdAt: true,
          wallets: { select: { currency: true, balance: true } },
          goldHoldings: { select: { grams: true } },
        },
      }),
    ]);

    return okPaged(
      users.map((user) => ({
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
          user.wallets.find((wallet) => wallet.currency === "USD")?.balance.toFixed(2) ??
          "0.00",
        goldGrams: user.goldHoldings[0]?.grams.toFixed(8) ?? "0.00000000",
      })),
      buildPagination(total, page, pageSize),
    );
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});

function buildUserWhere(searchParams: URLSearchParams): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const q = searchParams.get("q");
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const role = searchParams.get("role");
  if (role) where.role = role as Prisma.UserWhereInput["role"];
  const status = searchParams.get("status");
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };
  return where;
}

/** POST /api/admin/users — admin creates a user (seeds wallets for all currencies). */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const body = await parseBody(req);
    const parsed = parseOrThrow(createUserSchema, body, "createUser");

    const user = await createUser({
      name: parsed.name,
      email: parsed.email,
      password: parsed.password,
      role: parsed.role,
    });
    return ok(user, { status: 201 });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});