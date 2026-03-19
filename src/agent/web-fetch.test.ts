import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSafeFetchUrl, fetchWebPage, normalizePermissionScopeFromUrl } from "./web-fetch";

describe("web fetch url safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes permission scopes from URLs", () => {
    expect(normalizePermissionScopeFromUrl("https://www.example.com/a")).toBe("example.com");
  });

  it("rejects local and private hosts", () => {
    expect(() => assertSafeFetchUrl("http://localhost:3000")).toThrow("local or private");
    expect(() => assertSafeFetchUrl("http://127.0.0.1")).toThrow("local or private");
    expect(() => assertSafeFetchUrl("http://192.168.1.10")).toThrow("local or private");
    expect(() => assertSafeFetchUrl("http://172.16.0.1")).toThrow("local or private");
  });

  it("accepts public https URLs", () => {
    expect(assertSafeFetchUrl("https://example.com/hello").hostname).toBe("example.com");
  });

  it("fetches and extracts HTML pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '<html><head><title>Example</title><meta name="description" content="Desc"></head><body><h1>Hello world</h1></body></html>',
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      ),
    );

    const result = await fetchWebPage({ url: "https://example.com/post", maxBytes: 10000 });

    expect(result).toMatchObject({
      domain: "example.com",
      contentType: "text/html",
      title: "Example",
      description: "Desc",
    });
    expect(result.excerpt).toContain("Hello world");
  });

  it("rejects unsupported content types after fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("%PDF", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    );

    await expect(fetchWebPage({ url: "https://example.com/file", maxBytes: 10000 })).rejects.toThrow(
      "Unsupported content type",
    );
  });
});
