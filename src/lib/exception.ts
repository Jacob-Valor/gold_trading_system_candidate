import { Prisma } from "@/lib/prisma";
import { env } from "./config";
import { ApiError, UnauthorizedError, ForbiddenError, NotFoundError } from "./errors";

/** Normalize known Prisma errors into friendly ApiErrors. */
export function handlePrismaError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      return new ApiError(409, "CONFLICT", "A record with that value already exists");
    }
    if (e.code === "P2025") return new NotFoundError("Record not found");
    if (e.code === "P2003") {
      return new ApiError(422, "UNPROCESSABLE_ENTITY", "Referenced record does not exist");
    }
    if (e.code === "P2034") {
      return new ApiError(
        409,
        "CONCURRENT_UPDATE_CONFLICT",
        "Concurrent update conflict; retry the request",
      );
    }
  }
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (code === "40001" || code === "40P01") {
    return new ApiError(
      409,
      "CONCURRENT_UPDATE_CONFLICT",
      "Concurrent update conflict; retry the request",
    );
  }
  return new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}

/** Fail fast on a missing secret instead of signing with a weak default. */
export function requireJwtSecret(): string {
  return env("JWT_SECRET");
}

export const isUserDeleted = (deletedAt: Date | null): boolean => deletedAt !== null;

export { UnauthorizedError, ForbiddenError, NotFoundError };