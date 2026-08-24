import { Redis } from "ioredis";

/**
 * Lazy Redis singleton for distributed rate limiting.
 *
 * A failed initial connection is discarded so a later request can retry. Once
 * connected, ioredis handles transient reconnects; callers fall back while the
 * connection is unavailable.
 */

const REDIS_URL = process.env.REDIS_URL ?? "";

let redis: Redis | undefined;
let connecting: Promise<Redis | null> | undefined;

function buildClient(): Redis {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on("error", () => {
    /* Commands surface errors to callers; do not crash the process. */
  });
  client.on("end", () => {
    if (redis === client) redis = undefined;
  });
  return client;
}

function isRedisFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.name === "ReplyError" ||
    error.name === "AbortError" ||
    error.name === "MaxRetriesPerRequestError"
  ) {
    return true;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  return (
    error.stack?.includes("/node_modules/ioredis/") === true &&
    (error.message === "Connection is closed." ||
      error.message === "Command timed out" ||
      error.message === "Stream isn't writeable and enableOfflineQueue options is false")
  );
}

export async function getRedis(): Promise<Redis | null> {
  if (!REDIS_URL) return null;
  if (redis?.status === "ready") return redis;
  if (connecting) return connecting;
  if (redis) return redis;

  const client = redis ?? buildClient();
  redis = client;
  connecting = client
    .connect()
    .then(() => client)
    .catch(() => {
      client.disconnect();
      if (redis === client) redis = undefined;
      return null;
    })
    .finally(() => {
      connecting = undefined;
    });
  return connecting;
}

/** Run with Redis, falling back only for Redis transport or command failures. */
export async function withRedis<T>(fn: (r: Redis) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  const r = await getRedis();
  if (!r) return fallback();
  try {
    return await fn(r);
  } catch (error) {
    if (isRedisFailure(error)) return fallback();
    throw error;
  }
}

export { REDIS_URL };