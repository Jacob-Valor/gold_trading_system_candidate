import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/http";
import { handlePrismaError } from "@/lib/exception";
import { parseOrThrow, parseBody } from "@/lib/validate";
import { signAccessToken } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { wrap } from "@/lib/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(100),
});

/** POST /api/auth/login — verify credentials, reject deactivated users, return token. */
export const POST = wrap(async (req: NextRequest) => {
  try {
    const body = await parseBody(req);
    const parsed = parseOrThrow(loginSchema, body, "login");
    await rateLimit(req, { kind: "auth", key: parsed.email });

    const user = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (!user || user.deletedAt) {
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
        { status: 401 },
      );
    }

    const valid = await bcrypt.compare(parsed.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
        { status: 401 },
      );
    }

    const token = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    return ok({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    const err = handlePrismaError(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
});