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

const MAX_JSON_BODY_BYTES = 32 * 1024;

/** Parse JSON body with a bounded byte budget; empty body → {}. */
export async function parseBody(req: NextRequest): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    throw new ValidationError("Request body is too large");
  }

  try {
    if (!req.body) return {};
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_JSON_BODY_BYTES) {
          await reader.cancel();
          throw new ValidationError("Request body is too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder().decode(bytes);
    if (!text) return {};
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Request body must be valid JSON");
  }
}