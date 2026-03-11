export function renderTelegramHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rendered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isFence(line)) {
      const block: string[] = [];
      index += 1;

      while (index < lines.length && !isFence(lines[index] ?? "")) {
        block.push(lines[index] ?? "");
        index += 1;
      }

      rendered.push(`<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (bullet) {
      rendered.push(`• ${renderInline(bullet[1] ?? "")}`);
      continue;
    }

    rendered.push(renderInline(line));
  }

  return rendered.join("\n");
}

function renderInline(value: string): string {
  const parts = value.split(/(`[^`\n]+`)/g);

  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }

      return renderBold(escapeHtml(part));
    })
    .join("");
}

function renderBold(value: string): string {
  return value.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line);
}
