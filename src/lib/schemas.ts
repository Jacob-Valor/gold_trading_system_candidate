import Decimal from "decimal.js";
import { z } from "zod";

export const CURRENCY_SCHEMA = z.enum(["USD", "EUR", "LAK", "THB", "CNY"]);

const hasAtMostDecimalPlaces = (value: number, places: number) =>
  new Decimal(value).decimalPlaces() <= places;

export const AMOUNT_SCHEMA = z
  .number()
  .finite()
  .min(0.01)
  .max(1_000_000_000_000)
  .refine((value) => hasAtMostDecimalPlaces(value, 2), "amount must have at most 2 decimal places");

export const SIGNED_AMOUNT_SCHEMA = z
  .number()
  .finite()
  .refine((value) => Math.abs(value) >= 0.01, "amount must have an absolute value of at least 0.01")
  .refine(
    (value) => Math.abs(value) <= 1_000_000_000_000,
    "amount must have an absolute value of at most 1000000000000",
  )
  .refine((value) => hasAtMostDecimalPlaces(value, 2), "amount must have at most 2 decimal places");

export const PRICE_AMOUNT_SCHEMA = z
  .number()
  .finite()
  .min(0.01)
  .max(1_000_000)
  .refine(
    (value) => hasAtMostDecimalPlaces(value, 2),
    "pricePerGram must have at most 2 decimal places",
  );

export const GOLD_AMOUNT_SCHEMA = z
  .number()
  .finite()
  .min(0.00000001)
  .max(1_000_000)
  .refine(
    (value) => hasAtMostDecimalPlaces(value, 8),
    "goldAmount must have at most 8 decimal places",
  );

export const TYPE_SCHEMA = z.enum([
  "deposit",
  "withdraw",
  "trade_buy",
  "trade_sell",
  "adjustment",
]);

export const DATE_SCHEMA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "date must be YYYY-MM-DD or ISO");

export const SORT_SCHEMA = z.enum(["asc", "desc"]).default("desc");