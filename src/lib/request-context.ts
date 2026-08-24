import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "./errors";
import { enforceDefaultRateLimit, getRateLimitMetadata, parseRateLimitHeaders } from "./rate-limit";

export type Context = {
  requestId: string;
  params: Promise<Record<string, string>>;
};

export type RouteContext = { params: Promise<Record<string, string>> };

/**
 * Wrap a route handler with the general API limiter, request id, and security
 * headers. Forwards Next.js params via the second argument.
 */
export function wrap(
  handler: (req: NextRequest, ctx: Context & RouteContext) => Promise<NextResponse> | NextResponse,
) {
  return async (req: NextRequest, routeCtx?: { params?: Promise<Record<string, string>> }) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    let res: NextResponse;
    try {
      const path = new URL(req.url).pathname;
      const isAuthBootstrap = path === "/api/auth/login" || path === "/api/auth/register";
      if (!isAuthBootstrap) {
        const authorization = req.headers.get("authorization");
        const key = authorization?.startsWith("Bearer ")
          ? `bearer:${crypto.createHash("sha256").update(authorization.slice(7)).digest("hex")}`
          : `public:${path}`;
        await enforceDefaultRateLimit(req, undefined, key);
      }
      res = await handler(req, {
        requestId,
        params: routeCtx?.params ?? Promise.resolve({}),
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      res = NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    res.headers.set("x-request-id", requestId);
    res.headers.set("x-content-type-options", "nosniff");
    res.headers.set("x-frame-options", "DENY");
    res.headers.set("referrer-policy", "no-referrer");
    res.headers.set("x-xss-protection", "0");
    res.headers.set(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.headers.set("cache-control", "no-store");

    const rate = getRateLimitMetadata(req);
    if (rate) {
      const headers = parseRateLimitHeaders(rate.remaining, rate.resetAt, rate.limit);
      for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
      if (res.status === 429) {
        res.headers.set("retry-after", String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
      }
    }
    return res;
  };
}