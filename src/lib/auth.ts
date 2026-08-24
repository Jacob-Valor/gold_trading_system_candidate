import type { NextRequest } from "next/server";

import { prisma } from "./prisma";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { verifyAccessToken, JwtPayload, extractBearer } from "./jwt";
import { isUserDeleted } from "./exception";

export type AuthedRequest = NextRequest & { user: JwtPayload };

/**
 * Authenticate the request: extract the Bearer token, verify it, then load the
 * user from the DB so role changes and soft deletes take effect immediately
 * (stateless JWT payloads would otherwise stay valid after deactivation).
 */
export async function authenticate(req: NextRequest): Promise<AuthedRequest> {
  const token = extractBearer(req);
  if (!token) throw new UnauthorizedError("Bearer token required");

  const payload = verifyAccessToken(token);
  if (!payload.sub) throw new UnauthorizedError();

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, email: true, deletedAt: true },
  });
  if (!dbUser) throw new UnauthorizedError("Account no longer exists");
  if (isUserDeleted(dbUser.deletedAt)) {
    throw new UnauthorizedError("Account is deactivated");
  }

  const authed = req as AuthedRequest;
  authed.user = {
    sub: dbUser.id,
    role: dbUser.role,
    email: dbUser.email,
  };
  return authed;
}

/** Require the `admin` role. Must be called after `authenticate`. */
export function requireAdmin(req: AuthedRequest): AuthedRequest {
  if (req.user.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
  return req;
}