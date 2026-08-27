import { z } from "zod";
import { ValidationError } from "./errors";

/** Zero-trust query parsing: returns validated numbers with defaults.
 *  Robust against null/missing/NaN params (z.coerce would produce NaN and fail). */
function intParam(def: number, max: number) {
  return z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === "") return def;
      const n = Number(v);
      return Number.isFinite(n) && n >= 1 ? n : def;
    },
    z.number().int().max(max),
  );
}

export const paginationSchema = z.object({
  page: intParam(1, Number.MAX_SAFE_INTEGER),
  pageSize: intParam(20, 100),
});

export function getPagination(searchParams: URLSearchParams) {
  const result = paginationSchema.safeParse({
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });
  if (!result.success) {
    throw new ValidationError(
      "Invalid pagination",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const parsed = result.data;
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    skip: (parsed.page - 1) * parsed.pageSize,
    take: parsed.pageSize,
  };
}

export function buildPagination(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasNext: page * pageSize < total,
    hasPrevious: page > 1,
  };
}