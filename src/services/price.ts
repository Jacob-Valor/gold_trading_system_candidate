import Decimal from "decimal.js";

import type { Currency } from "@/lib/prisma";
import { readPrisma } from "@/lib/prisma";

/** Static settlement rates applied to the persisted USD price reference. */
const FX_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  LAK: 21_500,
  THB: 36.5,
  CNY: 7.25,
};

/**
 * Return the current gold price per gram in the requested settlement currency.
 * Price is persisted only as a USD reference; settlement conversion happens
 * on each request and is rounded exactly once by the trading service.
 */
export async function getLivePrice(currency: Currency): Promise<number> {
  const price = await readPrisma.price.findUnique({ where: { id: "singleton" } });
  if (!price || price.currency !== "USD") {
    throw new Error("USD gold price is not configured");
  }

  return new Decimal(price.pricePerGram.toString()).mul(FX_RATES[currency]).toNumber();
}