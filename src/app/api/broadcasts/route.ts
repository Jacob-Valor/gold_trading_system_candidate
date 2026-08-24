import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { prisma } from "@/lib/prisma";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/broadcasts — active broadcasts visible to all (auth-gated). */
export const GET = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    const now = new Date();

    const broadcasts = await prisma.broadcast.findMany({
      where: {
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return ok({ broadcasts });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});
