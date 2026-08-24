// Prisma 7 barrel: the generated client lives in src/generated/prisma.
// Re-export everything app code needs so imports stay at `@/lib/prisma`.
//
// The client is a lazy singleton. Constructing it requires DATABASE_URL, which
// is absent during `next build` (route modules get imported at build time), so
// creation is deferred to first actual use via getPrisma(). `prisma` is the
// same singleton without a Proxy — Prisma's internal `this` binding stays
// intact (a Proxy receiver broke reads intermittently).
//
// READ/WRITE SPLIT: `prisma` is the write client (used inside transactions with
// `$queryRaw` atomic updates). `readPrisma` is a SEPARATE client with its own
// pool, used only for plain reads. This isolates reads from the connection
// churn of `$queryRaw` writes, which intermittently returned stale/empty rows
// (the fuzz-caught zero-read bug).

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  PrismaClient,
  Prisma,
  type User,
  type Wallet,
  type Transaction,
  type Trade,
  type GoldHolding,
  type Adjustment,
  type Broadcast,
  type Price,
  Role,
  TransactionType,
  TradeType,
  Currency,
  $Enums,
} from "@/generated/prisma/client";

import { env } from "./config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; readPrisma?: PrismaClient };

function createClient(opts: { readOnly?: boolean } = {}): PrismaClient {
  const pool = new Pool({
    connectionString: env("DATABASE_URL"),
    min: 1,
    max: opts.readOnly ? 5 : 10, // reads get a smaller, dedicated pool
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    maxUses: 7500, // recycle connections periodically to avoid pg/libpq reuse bugs
    statement_timeout: 15_000,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });
  void client.$connect().catch(() => {});
  return client;
}

/** Lazily construct and cache the singleton write client. */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

/** Lazily construct and cache the singleton read-only client (separate pool). */
export function getReadPrisma(): PrismaClient {
  if (!globalForPrisma.readPrisma) globalForPrisma.readPrisma = createClient({ readOnly: true });
  return globalForPrisma.readPrisma;
}


/** Write client — used inside transactions (atomic $queryRaw + updates). */
export const prisma: PrismaClient = {
  get user() { return getPrisma().user; },
  get wallet() { return getPrisma().wallet; },
  get transaction() { return getPrisma().transaction; },
  get trade() { return getPrisma().trade; },
  get goldHolding() { return getPrisma().goldHolding; },
  get adjustment() { return getPrisma().adjustment; },
  get broadcast() { return getPrisma().broadcast; },
  get price() { return getPrisma().price; },
  get $transaction() { return getPrisma().$transaction.bind(getPrisma()); },
  get $queryRaw() { return getPrisma().$queryRaw.bind(getPrisma()); },
  get $disconnect() { return getPrisma().$disconnect.bind(getPrisma()); },
} as unknown as PrismaClient;

/** Read-only client — used for plain reads only (isolated from write churn). */
export const readPrisma: PrismaClient = {
  get user() { return getReadPrisma().user; },
  get wallet() { return getReadPrisma().wallet; },
  get transaction() { return getReadPrisma().transaction; },
  get trade() { return getReadPrisma().trade; },
  get goldHolding() { return getReadPrisma().goldHolding; },
  get adjustment() { return getReadPrisma().adjustment; },
  get broadcast() { return getReadPrisma().broadcast; },
  get price() { return getReadPrisma().price; },
  get $disconnect() { return getReadPrisma().$disconnect.bind(getReadPrisma()); },
} as unknown as PrismaClient;

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "40001" || code === "40P01";
}

/** Retry write conflicts/deadlocks with bounded exponential backoff. */
export async function withTransactionRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getPrisma().$transaction(operation, {
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 25 * 2 ** (attempt - 1));
      await promise;
    }
  }
}

export { Prisma, $Enums };
export type {
  User,
  Wallet,
  Transaction,
  Trade,
  GoldHolding,
  Adjustment,
  Broadcast,
  Price,
};
export { Role, TransactionType, TradeType, Currency, PrismaClient };