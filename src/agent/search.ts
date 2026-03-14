import type { WebSearchResult } from "./types";

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    publishedDate?: string;
  }>;
}

export class ExaSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(input: {
    query: string;
    limit: number;
    domains?: string[];
    recencyDays?: number;
    signal?: AbortSignal;
  }): Promise<WebSearchResult> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query: input.query,
        numResults: input.limit,
        type: "auto",
        contents: {
          text: false,
          highlights: {
            numSentences: 2,
          },
        },
        ...(input.domains && input.domains.length > 0 ? { includeDomains: input.domains } : {}),
        ...(input.recencyDays ? { startPublishedDate: new Date(Date.now() - input.recencyDays * 86400_000).toISOString() } : {}),
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(`Exa search failed with ${response.status}`);
    }

    const payload = (await response.json()) as ExaSearchResponse;
    const results = (payload.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title?.trim() || (item.url ?? "Untitled"),
        url: item.url ?? "",
        snippet: collapseWhitespace(item.text ?? "").slice(0, 280),
        domain: hostnameForUrl(item.url ?? "") ?? "unknown",
      }));

    return {
      query: input.query,
      results,
    };
  }
}

function hostnameForUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
