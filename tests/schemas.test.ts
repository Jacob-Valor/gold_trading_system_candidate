import { describe, expect, test } from "vitest";

import {
  AMOUNT_SCHEMA,
  CURRENCY_SCHEMA,
  DATE_SCHEMA,
  GOLD_AMOUNT_SCHEMA,
  PRICE_AMOUNT_SCHEMA,
  SIGNED_AMOUNT_SCHEMA,
  SORT_SCHEMA,
  TYPE_SCHEMA,
  dateBoundary,
} from "../src/lib/schemas";

function expectAccepted(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) {
  expect(schema.safeParse(value).success).toBe(true);
}

function expectRejected(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

describe("money amount validation", () => {
  test.each([0.01, 1, 123.45, 1_000_000_000_000])("accepts %s", (value) => {
    expectAccepted(AMOUNT_SCHEMA, value);
  });

  test.each([0, -1, 0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000.01])(
    "rejects %s",
    (value) => {
      expectRejected(AMOUNT_SCHEMA, value);
    },
  );
});

describe("signed admin adjustment validation", () => {
  test.each([0.01, -0.01, 500.25, -500.25])("accepts %s", (value) => {
    expectAccepted(SIGNED_AMOUNT_SCHEMA, value);
  });

  test.each([0, 0.001, -0.001, 1.111, -1.111, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects %s",
    (value) => {
      expectRejected(SIGNED_AMOUNT_SCHEMA, value);
    },
  );
});

describe("gold and price precision", () => {
  test.each([0.00000001, 1, 1.12345678, 1_000_000])("accepts gold amount %s", (value) => {
    expectAccepted(GOLD_AMOUNT_SCHEMA, value);
  });

  test.each([0, -1, 0.000000001, 1.123456789, 1_000_000.00000001])(
    "rejects gold amount %s",
    (value) => {
      expectRejected(GOLD_AMOUNT_SCHEMA, value);
    },
  );

  test.each([0.01, 125.42, 1_000_000])("accepts price %s", (value) => {
    expectAccepted(PRICE_AMOUNT_SCHEMA, value);
  });

  test.each([0, 0.001, 125.421, 1_000_000.01])("rejects price %s", (value) => {
    expectRejected(PRICE_AMOUNT_SCHEMA, value);
  });
});

describe("enums and query primitives", () => {
  test.each(["USD", "EUR", "LAK", "THB", "CNY"])("accepts currency %s", (value) => {
    expectAccepted(CURRENCY_SCHEMA, value);
  });

  test("rejects unsupported currencies", () => {
    expectRejected(CURRENCY_SCHEMA, "GBP");
  });

  test.each(["deposit", "withdraw", "trade_buy", "trade_sell", "adjustment"])(
    "accepts transaction type %s",
    (value) => {
      expectAccepted(TYPE_SCHEMA, value);
    },
  );

  test.each(["2026-08-25", "2026-08-25T12:30", "2026-08-25T12:30:45"])(
    "accepts date %s",
    (value) => {
      expectAccepted(DATE_SCHEMA, value);
    },
  );

  test.each([
    "25-08-2026",
    "2026/08/25",
    "not-a-date",
    "2026-02-30",
    "2026-99-99",
    "2026-08-25T24:00",
  ])("rejects date %s", (value) => {
    expectRejected(DATE_SCHEMA, value);
  });

  test("makes date-only upper bounds inclusive", () => {
    expect(dateBoundary("2026-08-25", "from").toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(dateBoundary("2026-08-25", "to").toISOString()).toBe("2026-08-25T23:59:59.999Z");
  });

  test("defaults sort order to descending", () => {
    expect(SORT_SCHEMA.parse(undefined)).toBe("desc");
  });
});
