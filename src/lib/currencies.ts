import type { Currency } from "@/lib/prisma";

export const CURRENCIES: Currency[] = ["USD", "EUR", "LAK", "THB", "CNY"];

/** Display metadata per supported currency. */
export const CURRENCY_META: Record<Currency, { symbol: string; decimals: number }> = {
  USD: { symbol: "$", decimals: 2 },
  EUR: { symbol: "€", decimals: 2 },
  LAK: { symbol: "₭", decimals: 0 },
  THB: { symbol: "฿", decimals: 2 },
  CNY: { symbol: "¥", decimals: 2 },
};

export const SUPPORTED_CURRENCIES = CURRENCIES;
export function currencyDisplay(currency: Currency): { symbol: string; decimals: number } {
  return CURRENCY_META[currency];
}