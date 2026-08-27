import "dotenv/config";
import { afterAll, describe, expect, test } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { z } from "zod";
const rawBaseUrl = process.env.BASE_URL;
const BASE_URL =
  rawBaseUrl && /^https?:\/\//.test(rawBaseUrl)
    ? rawBaseUrl.replace(/\/$/, "")
    : "http://127.0.0.1:3000";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin123!";
const PASSWORD = "Integration123!";
const runSegment = (Date.now() & 0xffff).toString(16);
let sequence = 0;
const createdUserIds: string[] = [];
const createdBroadcastTitles: string[] = [];
const cleanupUrl = process.env.TEST_CLEANUP_DATABASE_URL;
const cleanupPrisma = cleanupUrl
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: cleanupUrl }) })
  : undefined;

afterAll(async () => {
  if (!cleanupPrisma) return;
  try {
    if (createdBroadcastTitles.length > 0) {
      await cleanupPrisma.broadcast.deleteMany({
        where: { title: { in: createdBroadcastTitles } },
      });
    }
    if (createdUserIds.length > 0) {
      await cleanupPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } finally {
    await cleanupPrisma.$disconnect();
  }
});

const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasNext: z.boolean(),
  hasPrevious: z.boolean(),
});

const apiDataSchema = z
  .object({
    token: z.string().optional(),
    user: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
      })
      .passthrough()
      .optional(),
    wallets: z
      .array(z.object({ currency: z.string(), balance: z.string() }).passthrough())
      .optional(),
    goldGrams: z.string().optional(),
    walletId: z.string().optional(),
    previousBalance: z.string().optional(),
    balanceAfter: z.string().optional(),
    goldAmount: z.string().optional(),
    pricePerGram: z.string().optional(),
    totalCost: z.string().optional(),
    goldBalanceAfter: z.string().optional(),
    walletBalanceAfter: z.string().optional(),
    id: z.string().optional(),
    email: z.string().optional(),
    type: z.string().optional(),
    amount: z.string().optional(),
    deletedAt: z.string().nullable().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const apiDocumentSchema = z.object({
  data: z.union([apiDataSchema, z.array(apiDataSchema)]).optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  meta: z.object({ pagination: paginationSchema.optional() }).passthrough().optional(),
});

type ApiData = z.infer<typeof apiDataSchema>;
type ApiDocument = z.infer<typeof apiDocumentSchema>;

type ApiResponse = {
  status: number;
  headers: Headers;
  body: ApiDocument;
};

type UserSession = {
  id: string;
  email: string;
  password: string;
  token: string;
};

function uniqueEmail(label: string): string {
  sequence += 1;
  return `${label}.${Date.now().toString(36)}.${process.pid}.${sequence}@example.test`;
}

function uniqueIp(): string {
  sequence += 1;
  return `2001:db8:${runSegment}:${sequence.toString(16)}::1`;
}

async function api(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    ip?: string;
  } = {},
): Promise<ApiResponse> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.ip) headers.set("x-forwarded-for", options.ip);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = apiDocumentSchema.parse(text ? JSON.parse(text) : {});
  return { status: response.status, headers: response.headers, body };
}

function objectData(response: ApiResponse): ApiData {
  const data = response.body.data;
  if (!data || Array.isArray(data)) {
    throw new Error(`Expected object data in HTTP ${response.status} response`);
  }
  return data;
}

function arrayData(response: ApiResponse): ApiData[] {
  const data = response.body.data;
  if (!Array.isArray(data)) {
    throw new Error(`Expected array data in HTTP ${response.status} response`);
  }
  return data;
}

async function registerUser(label: string): Promise<UserSession> {
  const email = uniqueEmail(label);
  const response = await api("/api/auth/register", {
    method: "POST",
    ip: uniqueIp(),
    body: { name: `Integration ${label}`, email, password: PASSWORD },
  });
  expect(response.status).toBe(201);
  expect(response.body.error).toBeUndefined();
  const data = objectData(response);
  expect(data).toMatchObject({
    token: expect.any(String),
    user: { id: expect.any(String), email, role: "user" },
  });
  if (!data.token || !data.user?.id) throw new Error("Registration response omitted token or user id");
  createdUserIds.push(data.user.id);
  return {
    id: data.user.id,
    email,
    password: PASSWORD,
    token: data.token,
  };
}

let adminTokenPromise: Promise<string> | undefined;
function getAdminToken(): Promise<string> {
  adminTokenPromise ??= (async () => {
    const response = await api("/api/auth/login", {
      method: "POST",
      ip: uniqueIp(),
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(response.status).toBe(200);
    const data = objectData(response);
    expect(data).toMatchObject({
      token: expect.any(String),
      user: { email: ADMIN_EMAIL, role: "admin" },
    });
    if (!data.token) throw new Error("Admin login response omitted token");
    return data.token;
  })();
  return adminTokenPromise;
}

function expectMoney(value: unknown, exact?: string): void {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^-?\d+\.\d{2}$/);
  if (exact !== undefined) expect(value).toBe(exact);
}

function expectGold(value: unknown, exact?: string): void {
  expect(typeof value).toBe("string");
  expect(value).toMatch(/^\d+\.\d{8}$/);
  if (exact !== undefined) expect(value).toBe(exact);
}

function expectValidationFailure(response: ApiResponse): void {
  expect(response.status).toBe(400);
  expect(response.body.error?.code).toBe("VALIDATION_ERROR");
}

describe.sequential("running API integration contracts", () => {
  test("registers a unique account and logs in with the same identity", async () => {
    const user = await registerUser("register-login");
    const login = await api("/api/auth/login", {
      method: "POST",
      ip: uniqueIp(),
      body: { email: user.email, password: user.password },
    });

    expect(login.status).toBe(200);
    expect(objectData(login)).toMatchObject({
      token: expect.any(String),
      user: { id: user.id, email: user.email, role: "user" },
    });
  });

  test("deposits and withdraws exact fixed-point money values", async () => {
    const user = await registerUser("fixed-money");
    const deposit = await api("/api/wallet/deposit", {
      method: "POST",
      token: user.token,
      body: { amount: 10.1, currency: "USD" },
    });
    expect(deposit.status).toBe(201);
    expectMoney(objectData(deposit).balanceAfter, "10.10");

    const withdrawal = await api("/api/wallet/withdraw", {
      method: "POST",
      token: user.token,
      body: { amount: 0.1, currency: "USD" },
    });
    expect(withdrawal.status).toBe(200);
    const withdrawalData = objectData(withdrawal);
    expectMoney(withdrawalData.previousBalance, "10.10");
    expectMoney(withdrawalData.balanceAfter, "10.00");

    const wallet = await api("/api/wallet", { token: user.token });
    expect(wallet.status).toBe(200);
    const walletData = objectData(wallet);
    const usd = walletData.wallets?.find((item) => item.currency === "USD");
    expect(usd).toBeDefined();
    expectMoney(usd?.balance, "10.00");
    expectGold(walletData.goldGrams, "0.00000000");
  });

  test("rejects money below 0.01 or with more than two decimal places", async () => {
    const user = await registerUser("money-validation");
    const invalidRequests = await Promise.all([
      api("/api/wallet/deposit", {
        method: "POST",
        token: user.token,
        body: { amount: 0.009, currency: "USD" },
      }),
      api("/api/wallet/deposit", {
        method: "POST",
        token: user.token,
        body: { amount: 1.001, currency: "USD" },
      }),
      api("/api/wallet/withdraw", {
        method: "POST",
        token: user.token,
        body: { amount: 0.009, currency: "USD" },
      }),
      api("/api/wallet/withdraw", {
        method: "POST",
        token: user.token,
        body: { amount: 1.001, currency: "USD" },
      }),
    ]);

    for (const response of invalidRequests) expectValidationFailure(response);
  });

  test("rejects gold below 1e-8 or with more than eight decimal places", async () => {
    const user = await registerUser("gold-validation");
    const invalidRequests = await Promise.all([
      api("/api/trades/buy", {
        method: "POST",
        token: user.token,
        body: { goldAmount: 0.000000001, currency: "USD" },
      }),
      api("/api/trades/buy", {
        method: "POST",
        token: user.token,
        body: { goldAmount: 0.000000011, currency: "USD" },
      }),
      api("/api/trades/sell", {
        method: "POST",
        token: user.token,
        body: { goldAmount: 0.000000001, currency: "USD" },
      }),
      api("/api/trades/sell", {
        method: "POST",
        token: user.token,
        body: { goldAmount: 0.000000011, currency: "USD" },
      }),
    ]);

    for (const response of invalidRequests) expectValidationFailure(response);
  });

  test("records exactly one correctly typed ledger transaction per buy and sell", async () => {
    const adminToken = await getAdminToken();
    const foreignPrice = await api("/api/price", {
      method: "POST",
      token: adminToken,
      body: { currency: "EUR", pricePerGram: 100 },
    });
    expectValidationFailure(foreignPrice);

    const price = await api("/api/price", {
      method: "POST",
      token: adminToken,
      body: { currency: "USD", pricePerGram: 100 },
    });
    expect(price.status).toBe(200);
    expectMoney(objectData(price).pricePerGram, "100.00");

    const user = await registerUser("trade-ledger");
    const deposit = await api("/api/wallet/deposit", {
      method: "POST",
      token: user.token,
      body: { amount: 1000, currency: "USD" },
    });
    expect(deposit.status).toBe(201);

    const buy = await api("/api/trades/buy", {
      method: "POST",
      token: user.token,
      body: { goldAmount: 2, currency: "USD" },
    });
    expect(buy.status).toBe(200);
    const buyData = objectData(buy);
    expectGold(buyData.goldAmount, "2.00000000");
    expectMoney(buyData.pricePerGram, "100.00");
    expectMoney(buyData.totalCost, "200.00");
    expectGold(buyData.goldBalanceAfter, "2.00000000");
    expectMoney(buyData.walletBalanceAfter, "800.00");

    const sell = await api("/api/trades/sell", {
      method: "POST",
      token: user.token,
      body: { goldAmount: 0.5, currency: "USD" },
    });
    expect(sell.status).toBe(200);
    const sellData = objectData(sell);
    expectGold(sellData.goldAmount, "0.50000000");
    expectMoney(sellData.pricePerGram, "100.00");
    expectMoney(sellData.totalCost, "50.00");
    expectGold(sellData.goldBalanceAfter, "1.50000000");
    expectMoney(sellData.walletBalanceAfter, "850.00");

    const ledger = await api("/api/wallet/transactions?page=1&pageSize=100", {
      token: user.token,
    });
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta?.pagination?.total).toBe(3);
    const ledgerRows = arrayData(ledger);
    expect(ledgerRows).toHaveLength(3);
    expect(ledgerRows.map(({ type }) => type).sort()).toEqual([
      "deposit",
      "trade_buy",
      "trade_sell",
    ]);

    const trades = await api("/api/trades?page=1&pageSize=100", { token: user.token });
    expect(trades.status).toBe(200);
    expect(trades.body.meta?.pagination?.total).toBe(2);
    const tradeRows = arrayData(trades);
    expect(tradeRows).toHaveLength(2);
    expect(tradeRows.map(({ type }) => type).sort()).toEqual(["buy", "sell"]);
    for (const row of tradeRows) {
      expectGold(row.goldAmount);
      expectMoney(row.pricePerGram);
      expectMoney(row.totalCost);
      expectGold(row.goldBalanceAfter);
    }

    const buys = await api("/api/wallet/transactions?type=trade_buy", { token: user.token });
    expect(buys.status).toBe(200);
    expect(buys.body.meta?.pagination?.total).toBe(1);
    const buyTransactions = arrayData(buys);
    expect(buyTransactions).toHaveLength(1);
    expect(buyTransactions[0].type).toBe("trade_buy");
    expectMoney(buyTransactions[0].amount, "200.00");
    expectMoney(buyTransactions[0].balanceAfter, "800.00");

    const sells = await api("/api/wallet/transactions?type=trade_sell", { token: user.token });
    expect(sells.status).toBe(200);
    expect(sells.body.meta?.pagination?.total).toBe(1);
    const sellTransactions = arrayData(sells);
    expect(sellTransactions).toHaveLength(1);
    expect(sellTransactions[0].type).toBe("trade_sell");
    expectMoney(sellTransactions[0].amount, "50.00");
    expectMoney(sellTransactions[0].balanceAfter, "850.00");
  });

  test("serializes concurrent withdrawals without a negative balance", async () => {
    const user = await registerUser("concurrent-withdrawals");
    const deposit = await api("/api/wallet/deposit", {
      method: "POST",
      token: user.token,
      body: { amount: 1, currency: "USD" },
    });
    expect(deposit.status).toBe(201);

    const withdrawals = await Promise.all(
      Array.from({ length: 20 }, () =>
        api("/api/wallet/withdraw", {
          method: "POST",
          token: user.token,
          body: { amount: 0.1, currency: "USD" },
        }),
      ),
    );
    expect(withdrawals.filter((response) => response.status === 200)).toHaveLength(10);
    expect(withdrawals.filter((response) => response.status === 422)).toHaveLength(10);

    const wallet = await api("/api/wallet", { token: user.token });
    expect(wallet.status).toBe(200);
    const usd = objectData(wallet).wallets?.find((item) => item.currency === "USD");
    expect(usd).toBeDefined();
    expectMoney(usd?.balance, "0.00");
  });

  test("serializes concurrent sells so gold cannot be oversold", async () => {
    const user = await registerUser("concurrent-sells");
    const deposit = await api("/api/wallet/deposit", {
      method: "POST",
      token: user.token,
      body: { amount: 100, currency: "USD" },
    });
    expect(deposit.status).toBe(201);
    const buy = await api("/api/trades/buy", {
      method: "POST",
      token: user.token,
      body: { goldAmount: 1, currency: "USD" },
    });
    expect(buy.status).toBe(200);

    const sells = await Promise.all(
      Array.from({ length: 20 }, () =>
        api("/api/trades/sell", {
          method: "POST",
          token: user.token,
          body: { goldAmount: 0.1, currency: "USD" },
        }),
      ),
    );
    expect(sells.filter((response) => response.status === 200)).toHaveLength(10);
    expect(sells.filter((response) => response.status === 422)).toHaveLength(10);

    const wallet = await api("/api/wallet", { token: user.token });
    expect(wallet.status).toBe(200);
    expectGold(objectData(wallet).goldGrams, "0.00000000");
  });

  test("enforces authentication, admin RBAC, and soft deletion immediately", async () => {
    const unauthenticated = await api("/api/wallet");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error?.code).toBe("UNAUTHORIZED");

    const user = await registerUser("soft-delete");
    const forbidden = await api("/api/admin/users", { token: user.token });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");

    const adminToken = await getAdminToken();
    const deletion = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(deletion.status).toBe(200);
    expect(objectData(deletion)).toMatchObject({ id: user.id, message: "User deactivated" });

    const staleToken = await api("/api/wallet", { token: user.token });
    expect(staleToken.status).toBe(401);
    expect(staleToken.body.error?.code).toBe("UNAUTHORIZED");

    const newLogin = await api("/api/auth/login", {
      method: "POST",
      ip: uniqueIp(),
      body: { email: user.email, password: user.password },
    });
    expect(newLogin.status).toBe(401);
    expect(newLogin.body.error?.code).toBe("INVALID_CREDENTIALS");

    const deletedUsers = await api(
      `/api/admin/users?status=deleted&q=${encodeURIComponent(user.email)}&page=1&pageSize=1`,
      { token: adminToken },
    );
    expect(deletedUsers.status).toBe(200);
    expect(deletedUsers.body.meta?.pagination?.total).toBe(1);
    const deletedUserRows = arrayData(deletedUsers);
    expect(deletedUserRows[0]).toMatchObject({ id: user.id, email: user.email });
    expect(deletedUserRows[0].deletedAt).toEqual(expect.any(String));
  });

  test("honors pagination limits, metadata, and out-of-range pages", async () => {
    const user = await registerUser("pagination");
    for (const amount of [1, 2, 3, 4]) {
      const deposit = await api("/api/wallet/deposit", {
        method: "POST",
        token: user.token,
        body: { amount, currency: "USD" },
      });
      expect(deposit.status).toBe(201);
    }

    const first = await api("/api/wallet/transactions?page=1&pageSize=1", { token: user.token });
    expect(first.status).toBe(200);
    expect(arrayData(first)).toHaveLength(1);
    expect(first.body.meta?.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 4,
      totalPages: 4,
      hasNext: true,
      hasPrevious: false,
    });

    const last = await api("/api/wallet/transactions?page=4&pageSize=1", { token: user.token });
    expect(last.status).toBe(200);
    expect(arrayData(last)).toHaveLength(1);
    expect(last.body.meta?.pagination).toMatchObject({
      page: 4,
      pageSize: 1,
      total: 4,
      totalPages: 4,
      hasNext: false,
      hasPrevious: true,
    });

    const beyondLast = await api("/api/wallet/transactions?page=5&pageSize=1", { token: user.token });
    expect(beyondLast.status).toBe(200);
    expect(arrayData(beyondLast)).toEqual([]);
    expect(beyondLast.body.meta?.pagination).toMatchObject({ page: 5, totalPages: 4 });

    const maximumPageSize = await api("/api/wallet/transactions?page=1&pageSize=100", {
      token: user.token,
    });
    expect(maximumPageSize.status).toBe(200);
    expect(arrayData(maximumPageSize)).toHaveLength(4);
    expect(maximumPageSize.body.meta?.pagination).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 4,
      totalPages: 1,
    });

    expectValidationFailure(await api("/api/wallet/transactions?page=0", { token: user.token }));
    expectValidationFailure(await api("/api/wallet/transactions?pageSize=0", { token: user.token }));
    expectValidationFailure(await api("/api/wallet/transactions?pageSize=101", { token: user.token }));
  });

  test("covers admin operations, broadcasts, profile, filters, and multi-currency settlement", async () => {
    const adminToken = await getAdminToken();
    const mixedEmail = `CaseUser-${runSegment}@Example.TEST`;
    const created = await api("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: {
        name: "Case User",
        email: mixedEmail,
        password: PASSWORD,
        role: "user",
      },
    });
    expect(created.status).toBe(201);
    expect(objectData(created).email).toBe(mixedEmail.toLowerCase());

    const createdLogin = await api("/api/auth/login", {
      method: "POST",
      ip: uniqueIp(),
      body: { email: mixedEmail.toLowerCase(), password: PASSWORD },
    });
    expect(createdLogin.status).toBe(200);
    const createdToken = String(objectData(createdLogin).token);
    const createdId = String(objectData(createdLogin).user?.id);
    createdUserIds.push(createdId);

    const me = await api("/api/auth/me", { token: createdToken });
    expect(me.status).toBe(200);
    expect(objectData(me)).toMatchObject({
      id: createdId,
      email: mixedEmail.toLowerCase(),
      role: "user",
    });

    const deposit = await api("/api/wallet/deposit", {
      method: "POST",
      token: createdToken,
      body: { amount: 100, currency: "EUR" },
    });
    expect(deposit.status).toBe(201);

    const buy = await api("/api/trades/buy", {
      method: "POST",
      token: createdToken,
      body: { goldAmount: 0.5, currency: "EUR" },
    });
    expect(buy.status).toBe(200);
    expect(objectData(buy).currency).toBe("EUR");

    const sell = await api("/api/trades/sell", {
      method: "POST",
      token: createdToken,
      body: { goldAmount: 0.25, currency: "EUR" },
    });
    expect(sell.status).toBe(200);

    const adjustment = await api(`/api/admin/users/${createdId}/adjust`, {
      method: "POST",
      token: adminToken,
      body: { amount: 10, currency: "USD", reason: "Integration adjustment" },
    });
    expect(adjustment.status).toBe(200);
    expectMoney(objectData(adjustment).balanceAfter, "10.00");

    const broadcastTitle = `Integration broadcast ${runSegment}`;
    const broadcast = await api("/api/admin/broadcasts", {
      method: "POST",
      token: adminToken,
      body: {
        title: broadcastTitle,
        message: "Integration broadcast",
      },
    });
    expect(broadcast.status).toBe(201);
    createdBroadcastTitles.push(broadcastTitle);

    const broadcasts = await api("/api/broadcasts", { token: createdToken });
    expect(broadcasts.status).toBe(200);
    const activeBroadcasts = objectData(broadcasts).broadcasts;
    expect(Array.isArray(activeBroadcasts)).toBe(true);
    if (!Array.isArray(activeBroadcasts)) throw new Error("Expected broadcast array");
    expect(
      activeBroadcasts.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "title" in row &&
          row.title === broadcastTitle,
      ),
    ).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const filteredTransactions = await api(
      `/api/admin/transactions?userName=Case%20User&from=${today}&to=${today}&page=1&pageSize=100`,
      { token: adminToken },
    );
    expect(filteredTransactions.status).toBe(200);
    expect(filteredTransactions.body.meta?.pagination?.total).toBeGreaterThan(0);

    const invalidRole = await api("/api/admin/users?role=bogus", { token: adminToken });
    expectValidationFailure(invalidRole);
  });

  test("keeps Redis auth attempts rate-limited after the threshold and emits rate headers", async () => {
    const ip = `2001:db8:${runSegment}:ffff::1`;
    const email = uniqueEmail("rate-limit-missing");
    const attempts: ApiResponse[] = [];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      attempts.push(
        await api("/api/auth/login", {
          method: "POST",
          ip,
          body: { email, password: PASSWORD },
        }),
      );
    }

    expect(attempts.slice(0, 10).map(({ status }) => status)).toEqual(Array(10).fill(401));
    expect(attempts[10].status).toBe(429);
    expect(attempts[11].status).toBe(429);
    for (const response of attempts) {
      expect(response.headers.get("x-ratelimit-remaining")).toMatch(/^\d+$/);
      expect(response.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
    }
  });
});
