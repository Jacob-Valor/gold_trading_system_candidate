import { describe, expect, test } from "vitest";

import { parseBody } from "../src/lib/validate";

describe("bounded JSON body parsing", () => {
  test("rejects an oversized declared body before parsing", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-length": "32769" },
      body: "{}",
    });

    await expect(parseBody(request as never)).rejects.toThrow("Request body is too large");
  });

  test("parses a valid small JSON body", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ amount: 10 }),
    });

    await expect(parseBody(request as never)).resolves.toEqual({ amount: 10 });
  });
});
