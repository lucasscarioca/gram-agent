import type { WebFetchResult } from "./types";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

export function normalizePermissionScopeFromUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

export function assertSafeFetchUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "::1" ||
    hostname.startsWith("[::1") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))
  ) {
    throw new Error("This URL points to a local or private host.");
  }

  return url;
}

export async function fetchWebPage(input: {
  url: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<WebFetchResult> {
  const initialUrl = assertSafeFetchUrl(input.url);
  const response = await fetch(initialUrl, {
    redirect: "follow",
    signal: input.signal,
    headers: {
      "user-agent": "gram-agent/0.0",
      accept: "text/html, text/plain, application/json, text/markdown;q=0.9, */*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`);
  }

  const finalUrl = assertSafeFetchUrl(response.url || initialUrl.toString());
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
  const body = await readTextBody(response, input.maxBytes);

  if (!isSupportedTextContentType(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const extracted =
    contentType === "text/html"
      ? extractHtmlContent(body.text)
      : {
          title: undefined,
          description: undefined,
          excerpt: collapseWhitespace(body.text).slice(0, 12_000),
        };

  return {
    url: initialUrl.toString(),
    finalUrl: finalUrl.toString(),
    domain: normalizePermissionScopeFromUrl(finalUrl.toString()),
    contentType,
    title: extracted.title,
    description: extracted.description,
    excerpt: extracted.excerpt,
    truncated: body.truncated || extracted.excerpt.length >= 12_000,
  };
}

async function readTextBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();

  if (!reader) {
    return { text: "", truncated: false };
  }

  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      truncated = true;
      text += decoder.decode(value.subarray(0, Math.max(0, maxBytes - (total - value.byteLength))), { stream: true });
      await reader.cancel();
      break;
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  return { text, truncated };
}

function isSupportedTextContentType(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/ld+json" ||
    contentType === "application/xml" ||
    contentType === "text/markdown"
  );
}

function extractHtmlContent(html: string): { title?: string; description?: string; excerpt: string } {
  const title = matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    matchMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ??
    matchMeta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');

  return {
    title: title ? decodeHtml(collapseWhitespace(title)) : undefined,
    description: description ? decodeHtml(collapseWhitespace(description)) : undefined,
    excerpt: collapseWhitespace(stripped).slice(0, 12_000),
  };
}

function matchMeta(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1];
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
