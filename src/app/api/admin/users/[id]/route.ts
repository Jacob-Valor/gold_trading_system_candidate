import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";
import { authenticate, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { wrap, type Context } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/users/[id] — single user with balances + gold holding. */
export const GET = wrap(async (req: NextRequest, ctx: Context) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const { id } = await ctx.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        deletedAt: true,
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

/** DELETE /api/admin/users/[id] — soft delete: user can no longer log in or transact. */
export const DELETE = wrap(async (req: NextRequest, ctx: Context) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const { id } = await ctx.params;
    if (id === authed.user.sub) {
      return NextResponse.json(
        { error: { code: "INVALID_OPERATION", message: "You cannot deactivate your own account" } },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "User not found" } },
        { status: 404 },
      );
    }

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json(
      {
        data: {
          id,
          deletedAt: new Date().toISOString(),
          message: "User deactivated",
        },
      },
      { status: 200 },
    );
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});