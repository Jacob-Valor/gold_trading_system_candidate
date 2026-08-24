import type { NextRequest } from "next/server";

import type { ZodType } from "zod";
import { ValidationError } from "./errors";

/** Parse & validate `value` against `schema`; throws ApiError(400) with field details. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, targetLabel: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `Invalid ${targetLabel}`,
      result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    );
  }
  return result.data;
}

/** Parse JSON body; empty body → {}. Throws 400 on malformed JSON. */
export async function parseBody(req: NextRequest): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}