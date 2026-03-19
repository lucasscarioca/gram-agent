import { afterEach, describe, expect, it, vi } from "vitest";

import { ExaSearchProvider } from "./search";

describe("Exa search provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Exa responses into search results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: " Example title ",
            url: "https://example.com/post",
            text: "Hello   world",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ExaSearchProvider("exa-key");
    const result = await provider.search({ query: "hello", limit: 3 });

    expect(result).toEqual({
      query: "hello",
      results: [
        {
          title: "Example title",
          url: "https://example.com/post",
          snippet: "Hello world",
          domain: "example.com",
        },
      ],
    });
  });

  it("passes recency and domain filters to Exa", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-15T00:00:00.000Z").getTime());

    const provider = new ExaSearchProvider("exa-key");
    await provider.search({ query: "hello", limit: 2, domains: ["example.com"], recencyDays: 7 });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      query: "hello",
      numResults: 2,
      includeDomains: ["example.com"],
      startPublishedDate: "2026-03-08T00:00:00.000Z",
    });
  });
});
