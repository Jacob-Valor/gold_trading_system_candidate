import type { NextRequest } from "next/server";

import { ApiError, ValidationError } from "./errors";
import { JwtPayload } from "./jwt";
import { withRedis } from "./redis";

type RateLimitKind = keyof typeof routeDefault;
type Bucket = { count: number; resetAt: number };
type LimitResult = { remaining: number; resetAt: number; exceeded: boolean };

export type RateLimitMetadata = {
  limit: number;
  remaining: number;
  resetAt: number;
};

/** Simple in-memory fixed-window rate limiter (fallback when Redis is absent). */
class SlidingFixedWindow {
  private buckets = new Map<string, Bucket>();

  constructor(
    private windowMs: number,
    private limit: number,
  ) {}

  consume(key: string): LimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { remaining: this.limit - 1, resetAt: now + this.windowMs, exceeded: false };
    }
    bucket.count += 1;
    return {
      remaining: Math.max(this.limit - bucket.count, 0),
      resetAt: bucket.resetAt,
      exceeded: bucket.count > this.limit,
    };
  }

  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

// With Redis present these limits apply cluster-wide; otherwise they are per-process.
const routeDefault = {
  auth: { windowMs: 15 * 60 * 1000, limit: 10 },
  authClient: { windowMs: 15 * 60 * 1000, limit: 100 },
  sensitive: { windowMs: 60 * 1000, limit: 30 },
  general: { windowMs: 60 * 1000, limit: 120 },
} as const;

const limiterCache = new Map<RateLimitKind, SlidingFixedWindow>();
const requestRateMetadata = new WeakMap<NextRequest, RateLimitMetadata>();

function limiterFor(kind: RateLimitKind): SlidingFixedWindow {
  if (!limiterCache.has(kind)) {
    limiterCache.set(kind, new SlidingFixedWindow(routeDefault[kind].windowMs, routeDefault[kind].limit));
  }
  return limiterCache.get(kind)!;
}

let lastSweep = 0;

function proxyIp(req: NextRequest): string | undefined {
  if (process.env.TRUST_PROXY !== "true") return undefined;
  return req.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim() || undefined;
}

function keyFor(
  req: NextRequest,
  kind: RateLimitKind,
  user: JwtPayload | null | undefined,
  keyOverride: string | undefined,
): string {
  const trustedIp = proxyIp(req);
  if (keyOverride !== undefined) {
    return `${kind}:${keyOverride}${trustedIp ? `:${trustedIp}` : ""}`;
  }
  return `${kind}:${user?.sub ?? trustedIp ?? "anonymous"}`;
}

/**
 * Authentication gets both an account bucket and an independent client bucket.
 * Without a trusted proxy address, the client bucket intentionally falls back
 * to a bounded global bucket rather than trusting spoofable forwarding headers.
 */
export async function rateLimitAuth(req: NextRequest, accountKey: string): Promise<void> {
  await rateLimit(req, { kind: "auth", key: accountKey });
  await rateLimit(req, { kind: "authClient", key: proxyIp(req) ?? "anonymous" });
}
export async function rateLimit(
  req: NextRequest,
  opts: { kind?: RateLimitKind; user?: JwtPayload | null; key?: string } = {},
): Promise<{ remaining: number; resetAt: number }> {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const limiter of limiterCache.values()) limiter.sweep(now);
    lastSweep = now;
  }

  const kind = opts.kind ?? "general";
  const { windowMs, limit } = routeDefault[kind];
  const key = keyFor(req, kind, opts.user, opts.key);
  const result = await withRedis(
    async (redis) => {
      const redisKey = `rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, windowMs);
      let ttl = await redis.pttl(redisKey);
      if (ttl <= 0) {
        await redis.pexpire(redisKey, windowMs);
        ttl = windowMs;
      }
      return {
        remaining: Math.max(limit - count, 0),
        resetAt: now + (ttl > 0 ? ttl : windowMs),
        exceeded: count > limit,
      };
    },
    () => limiterFor(kind).consume(key),
  );

  requestRateMetadata.set(req, {
    limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
  });
  if (result.exceeded) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests — please slow down.", {
      resetAt: new Date(result.resetAt).toISOString(),
    });
  }
  return { remaining: result.remaining, resetAt: result.resetAt };
}

export async function enforceDefaultRateLimit(
  req: NextRequest,
  user?: JwtPayload | null,
  key?: string,
): Promise<void> {
  await rateLimit(req, { kind: "general", user, key });
}

export function getRateLimitMetadata(req: NextRequest): RateLimitMetadata | undefined {
  return requestRateMetadata.get(req);
}

export function parseRateLimitHeaders(
  remaining: number | undefined,
  resetAt: number | undefined,
  limit?: number,
) {
  return {
    ...(limit !== undefined ? { "x-ratelimit-limit": String(limit) } : {}),
    ...(remaining !== undefined ? { "x-ratelimit-remaining": String(remaining) } : {}),
    ...(resetAt !== undefined ? { "x-ratelimit-reset": String(Math.ceil(resetAt / 1000)) } : {}),
  };
}

export { ValidationError };