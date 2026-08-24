import { z } from "zod";

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
  const parsed = paginationSchema.parse({
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });
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