import { NextResponse } from "next/server";
import { z } from "zod";

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { signAccessToken } from "@/lib/jwt";
import { rateLimitAuth } from "@/lib/rate-limit";
import { createUser } from "@/services/user";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(100),
});

/** POST /api/auth/register — create account + wallets, return token. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const body = await parseBody(req);
    const parsed = parseOrThrow(registerSchema, body, "register");
    await rateLimitAuth(req, parsed.email);

    const user = await createUser({
      name: parsed.name,
      email: parsed.email,
      password: parsed.password,
    });

    const token = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    return ok({ token, user }, { status: 201 });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});