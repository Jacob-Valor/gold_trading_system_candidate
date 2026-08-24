import type { NextRequest } from "next/server";

import jwt, { type SignOptions } from "jsonwebtoken";

import { requireJwtSecret, UnauthorizedError } from "./exception";

const JWT_ISSUER = "gold-trading-system";
const JWT_AUDIENCE = "gold-trading-api";

export interface JwtPayload {
  sub: string;
  role: "user" | "admin";
  email: string;
}

const expiresIn = (process.env.JWT_EXPIRES_IN ?? "24h") as SignOptions["expiresIn"];

/** Sign an access token with the user's id and role. */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, requireJwtSecret(), {
    algorithm: "HS256",
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/** Verify & decode; throws UnauthorizedError with distinct messages. */
export function verifyAccessToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, requireJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof decoded === "string" || !decoded.sub || !decoded.role) {
      throw new Error("malformed payload");
    }
    return {
      sub: String(decoded.sub),
      role: decoded.role as JwtPayload["role"],
      email: String(decoded.email ?? ""),
    };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Token has expired");
    }
    throw new UnauthorizedError("Invalid or malformed token");
  }
}

/** Extract Bearer token from Authorization header. */
export function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}