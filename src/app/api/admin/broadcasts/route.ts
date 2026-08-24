import { NextResponse } from "next/server";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { authenticate, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const broadcastSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(5000),
  active: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
});

/** POST /api/admin/broadcasts — admin creates a system-wide broadcast. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const authed = await authenticate(req);
    requireAdmin(authed);

    const body = await parseBody(req);
    const parsed = parseOrThrow(broadcastSchema, body, "broadcast");

    const broadcast = await prisma.broadcast.create({
      data: {
        title: parsed.title,
        message: parsed.message,
        active: parsed.active,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        createdBy: authed.user.sub,
      },
    });

    return ok(
      {
        id: broadcast.id,
        title: broadcast.title,
        message: broadcast.message,
        active: broadcast.active,
        expiresAt: broadcast.expiresAt,
        createdAt: broadcast.createdAt,
      },
      { status: 201 },
    );
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});