import { prisma } from "@/lib/prisma";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";

/** Reject deleted users for any transaction-capable action. */
export async function ensureUserActive(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
  if (!user) throw new UnauthorizedError("Account no longer exists");
  if (user.deletedAt) throw new ForbiddenError("Account is deactivated");
}

export async function ensureNotSoftDeleted(userId: string): Promise<void> {
  return ensureUserActive(userId);
}

export function adminOnly(role: string | undefined): void {
  if (role !== "admin") throw new ForbiddenError("Admin role required");
}

export function userFromRequest<T extends { user?: { sub?: string } }>(req: T): string {
  const sub = req.user?.sub;
  if (!sub) throw new UnauthorizedError("Authentication required");
  return sub;
}

export { ValidationError };