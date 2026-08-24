import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CONFIG,
  env,
  priceServiceInterval,
  priceServicePaused,
  simulatedDepositsEnabled,
} from "../src/lib/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("simulated deposit feature gate", () => {
  test("defaults disabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SIMULATED_DEPOSITS", "");

    expect(simulatedDepositsEnabled()).toBe(false);
  });

  test("can be explicitly enabled for the candidate demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SIMULATED_DEPOSITS", "true");

    expect(simulatedDepositsEnabled()).toBe(true);
  });

  test("defaults enabled during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_SIMULATED_DEPOSITS", "");

    expect(simulatedDepositsEnabled()).toBe(true);
  });
});

describe("environment configuration", () => {
  test("returns configured values and rejects missing required values", () => {
    vi.stubEnv("TEST_REQUIRED_VALUE", "configured");
    expect(env("TEST_REQUIRED_VALUE")).toBe("configured");

    vi.stubEnv("TEST_REQUIRED_VALUE", "");
    expect(() => env("TEST_REQUIRED_VALUE")).toThrow(
      "Missing required environment variable: TEST_REQUIRED_VALUE",
    );
  });

  test("reads required and default application settings", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://example");
    vi.stubEnv("JWT_SECRET", "secret");
    vi.stubEnv("JWT_EXPIRES_IN", "2h");
    vi.stubEnv("GOLD_PRICE_USD", "140.25");
    vi.stubEnv("MOCK_DELAY_MS", "50");

    expect(CONFIG.databaseUrl).toBe("postgresql://example");
    expect(CONFIG.jwtSecret).toBe("secret");
    expect(CONFIG.jwtExpiresIn).toBe("2h");
    expect(CONFIG.goldBasePriceUsd()).toBe(140.25);
    expect(CONFIG.mockDelayMs()).toBe(50);
  });

  test("applies price-service pause and interval rules", () => {
    vi.stubEnv("PRICE_PAUSED", "paused");
    vi.stubEnv("PRICE_INTERVAL_MS", "500");
    expect(priceServicePaused()).toBe(true);
    expect(priceServiceInterval()).toBe(1_000);

    vi.stubEnv("PRICE_PAUSED", "running");
    vi.stubEnv("PRICE_INTERVAL_MS", "7500");
    expect(priceServicePaused()).toBe(false);
    expect(priceServiceInterval()).toBe(7_500);
  });
});

  test("uses defaults when optional settings are absent", () => {
    const names = [
      "JWT_EXPIRES_IN",
      "GOLD_PRICE_USD",
      "SEED_ADMIN_EMAIL",
      "SEED_ADMIN_PASSWORD",
      "SEED_USER_EMAIL",
      "SEED_USER_PASSWORD",
      "MOCK_DELAY_MS",
      "PRICE_PAUSED",
      "PRICE_INTERVAL_MS",
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];

      expect(CONFIG.jwtExpiresIn).toBe("24h");
      expect(CONFIG.goldBasePriceUsd()).toBe(125.42);
      expect(CONFIG.seedAdminEmail()).toBe("admin@example.com");
      expect(CONFIG.seedAdminPassword()).toBe("Admin123!");
      expect(CONFIG.seedUserEmail()).toBe("user@example.com");
      expect(CONFIG.seedUserPassword()).toBe("User123!");
      expect(CONFIG.mockDelayMs()).toBe(0);
      expect(priceServicePaused()).toBe(false);
      expect(priceServiceInterval()).toBe(5_000);
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("reads configured seed identities and production mode", () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", "admin@test.example");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "admin-secret");
    vi.stubEnv("SEED_USER_EMAIL", "user@test.example");
    vi.stubEnv("SEED_USER_PASSWORD", "user-secret");
    vi.stubEnv("NODE_ENV", "production");

    expect(CONFIG.seedAdminEmail()).toBe("admin@test.example");
    expect(CONFIG.seedAdminPassword()).toBe("admin-secret");
    expect(CONFIG.seedUserEmail()).toBe("user@test.example");
    expect(CONFIG.seedUserPassword()).toBe("user-secret");
    expect(CONFIG.isProduction).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(CONFIG.isProduction).toBe(false);
  });
