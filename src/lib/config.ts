/** Fail fast on missing env var — called lazily so module import never throws at build time. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const CONFIG = {
  get databaseUrl() {
    return env("DATABASE_URL");
  },
  get jwtSecret() {
    return env("JWT_SECRET");
  },
  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN ?? "24h";
  },
  goldBasePriceUsd: () => Number(process.env.GOLD_PRICE_USD ?? "125.42"),
  seedAdminEmail: () => env("SEED_ADMIN_EMAIL"),
  seedAdminPassword: () => env("SEED_ADMIN_PASSWORD"),
  seedUserEmail: () => env("SEED_USER_EMAIL"),
  seedUserPassword: () => env("SEED_USER_PASSWORD"),
  mockDelayMs: () => Number(process.env.MOCK_DELAY_MS ?? "0"),
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

/** Demo funding is disabled by default in production and enabled in development. */
export function simulatedDepositsEnabled(): boolean {
  const configured = process.env.ALLOW_SIMULATED_DEPOSITS;
  if (configured?.trim()) {
    return configured.toLowerCase() === "true";
  }
  return process.env.NODE_ENV !== "production";
}

const PAUSED_REASONS = new Set<string>(["paused", "pause"]);
export function priceServicePaused(): boolean {
  return PAUSED_REASONS.has(process.env.PRICE_PAUSED ?? "");
}
export function priceServiceInterval(): number {
  return Math.max(1000, Number(process.env.PRICE_INTERVAL_MS ?? "5000"));
}