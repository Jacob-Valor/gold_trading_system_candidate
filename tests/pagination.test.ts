import { describe, expect, test } from "vitest";

import { buildPagination, getPagination, paginationSchema } from "../src/lib/pagination";

describe("getPagination", () => {
  test("uses defaults when parameters are missing", () => {
    expect(getPagination(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  test("uses defaults for empty values", () => {
    expect(getPagination(new URLSearchParams("page=&pageSize="))).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  test("calculates skip and take for valid values", () => {
    expect(getPagination(new URLSearchParams("page=3&pageSize=25"))).toEqual({
      page: 3,
      pageSize: 25,
      skip: 50,
      take: 25,
    });
  });

  test.each([
    ["page=0&pageSize=0", { page: 1, pageSize: 20, skip: 0, take: 20 }],
    ["page=-5&pageSize=-1", { page: 1, pageSize: 20, skip: 0, take: 20 }],
    ["page=abc&pageSize=xyz", { page: 1, pageSize: 20, skip: 0, take: 20 }],
  ])("falls back for invalid numeric values: %s", (query, expected) => {
    expect(getPagination(new URLSearchParams(query))).toEqual(expected);
  });

  test("rejects fractional page values", () => {
    expect(() => getPagination(new URLSearchParams("page=1.5"))).toThrow();
  });

  test("rejects a page size over 100", () => {
    expect(() => getPagination(new URLSearchParams("pageSize=101"))).toThrow();
  });

  test("accepts the maximum page size", () => {
    expect(getPagination(new URLSearchParams("page=2&pageSize=100"))).toEqual({
      page: 2,
      pageSize: 100,
      skip: 100,
      take: 100,
    });
  });
});

describe("paginationSchema", () => {
  test("coerces valid string values", () => {
    expect(paginationSchema.parse({ page: "4", pageSize: "10" })).toEqual({
      page: 4,
      pageSize: 10,
    });
  });
});

describe("buildPagination", () => {
  test("calculates pages and navigation flags", () => {
    expect(buildPagination(51, 2, 25)).toEqual({
      page: 2,
      pageSize: 25,
      total: 51,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
  });

  test("returns one page for an empty collection", () => {
    expect(buildPagination(0, 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    });
  });

  test("marks the final page correctly", () => {
    expect(buildPagination(40, 2, 20)).toMatchObject({
      totalPages: 2,
      hasNext: false,
      hasPrevious: true,
    });
  });
});
