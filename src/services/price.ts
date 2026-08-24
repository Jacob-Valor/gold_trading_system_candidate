import Decimal from "decimal.js";

import type { Currency } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";

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
  let price = await prisma.price.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", currency: "USD", pricePerGram: 125.42 },
    update: {},
  });
  if (price.currency !== "USD") {
    price = await prisma.price.update({
      where: { id: price.id },
      data: { currency: "USD" },
    });
  }

  return new Decimal(price.pricePerGram.toString()).mul(FX_RATES[currency]).toNumber();
}