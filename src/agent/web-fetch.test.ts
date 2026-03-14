import { describe, expect, it } from "vitest";

import { assertSafeFetchUrl, normalizePermissionScopeFromUrl } from "./web-fetch";

describe("web fetch url safety", () => {
  it("normalizes permission scopes from URLs", () => {
    expect(normalizePermissionScopeFromUrl("https://www.example.com/a")).toBe("example.com");
  });

  it("rejects local and private hosts", () => {
    expect(() => assertSafeFetchUrl("http://localhost:3000")).toThrow("local or private");
    expect(() => assertSafeFetchUrl("http://127.0.0.1")).toThrow("local or private");
    expect(() => assertSafeFetchUrl("http://192.168.1.10")).toThrow("local or private");
  });

  it("accepts public https URLs", () => {
    expect(assertSafeFetchUrl("https://example.com/hello").hostname).toBe("example.com");
  });
});
