import { NextResponse } from "next/server";

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export function ok<T>(
  data: T,
  opts: { status?: number; meta?: Record<string, unknown> } = {},
): NextResponse {
  return NextResponse.json(
    { data, ...(opts.meta ? { meta: opts.meta } : {}) },
    { status: opts.status ?? 200 },
  );
}

export function okPaged<T>(
  items: T[],
  pagination: Pagination,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({
    data: items,
    meta: { pagination, ...extra },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}