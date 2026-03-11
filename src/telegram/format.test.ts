import { describe, expect, it } from "vitest";

import { renderTelegramHtml } from "./format";

describe("renderTelegramHtml", () => {
  it("formats basic Telegram-safe inline styles", () => {
    expect(renderTelegramHtml("Use **bold** and `code`.\n- one\n- two")).toBe(
      "Use <b>bold</b> and <code>code</code>.\n• one\n• two",
    );
  });

  it("escapes HTML outside supported formatting", () => {
    expect(renderTelegramHtml("x < y && `a < b`")).toBe("x &lt; y &amp;&amp; <code>a &lt; b</code>");
  });

  it("renders fenced code blocks as preformatted HTML", () => {
    expect(renderTelegramHtml("Before\n```ts\nconst x = 1 < 2;\n```\nAfter")).toBe(
      "Before\n<pre><code>const x = 1 &lt; 2;</code></pre>\nAfter",
    );
  });

  it("treats an unclosed fence as a code block until the end", () => {
    expect(renderTelegramHtml("```\\nconst x = 1;")).toBe("<pre><code></code></pre>");
  });
});
