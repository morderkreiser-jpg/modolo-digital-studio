// The small markdown subset the assistant is allowed to write (see the prompt rules): paragraphs,
// line breaks, **bold**, "- " / "1. " lists and [label](url) links. Pure functions only: the
// renderer (rich-text.tsx) turns the tokens into React elements, never into an HTML string.

export type LinkTarget = "internal" | "external" | "direct";

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: InlineToken[] }
  | { kind: "link"; label: string; href: string; target: LinkTarget };

export type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;
// An indented line right after a list item continues that item (models wrap long bullets so).
const CONTINUATION_RE = /^\s{2,}\S/;
// **bold** | [label](url) | bare https URL (trailing punctuation stays outside the link).
const INLINE_RE =
  /\*\*(.+?)\*\*|\[([^\]\n]{1,200})\]\(([^()\s]{1,2048})\)|(https:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?])/g;
// Same-site path: one leading slash, no "//" or "/\" (browsers read both as another host).
const INTERNAL_RE = /^\/(?![/\\])[^\s\\]*$/;
const MAILTO_RE = /^mailto:[^\s@/]+@[^\s@/]+\.[^\s@/]+$/i;
const TEL_RE = /^tel:\+?[0-9][0-9 ()./-]{2,24}$/i;

/** Classify a link target; null means "not allowed, show the label as plain text". */
export function safeLink(raw: string): { href: string; target: LinkTarget } | null {
  const href = raw.trim();
  if (INTERNAL_RE.test(href)) return { href, target: "internal" };
  if (MAILTO_RE.test(href) || TEL_RE.test(href)) return { href, target: "direct" };
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && url.hostname) return { href: url.href, target: "external" };
  } catch {
    // Not an absolute URL: falls through to "not allowed".
  }
  return null;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      current = null;
      continue;
    }
    const bullet = BULLET_RE.exec(raw);
    const ordered = bullet ? null : ORDERED_RE.exec(raw);
    if (bullet) {
      if (current?.kind !== "ul") {
        current = { kind: "ul", items: [] };
        blocks.push(current);
      }
      current.items.push(bullet[1].trim());
    } else if (ordered) {
      if (current?.kind !== "ol") {
        current = { kind: "ol", items: [], start: Number(ordered[1]) };
        blocks.push(current);
      }
      current.items.push(ordered[2].trim());
    } else if (current && current.kind !== "p" && CONTINUATION_RE.test(raw)) {
      current.items[current.items.length - 1] += ` ${line}`;
    } else {
      // Headings are not part of the allowed style; if one slips through it reads as bold.
      const heading = HEADING_RE.exec(raw);
      if (current?.kind !== "p") {
        current = { kind: "p", lines: [] };
        blocks.push(current);
      }
      current.lines.push(heading ? `**${heading[1].trim()}**` : line);
    }
  }
  return blocks;
}

/**
 * Inline tokens of one line. While an answer is still streaming, an opening "**" whose closing
 * pair has not arrived yet is rendered as bold right away instead of flashing two asterisks.
 */
export function parseInline(text: string, streaming = false, allowBold = true): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const [whole, bold, label, href, bare] = match;
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", text: text.slice(last, index) });
    if (bold !== undefined) {
      tokens.push(
        allowBold ? { kind: "bold", children: parseInline(bold, false, false) } : { kind: "text", text: bold },
      );
    } else if (label !== undefined && href !== undefined) {
      const link = safeLink(href);
      tokens.push(link ? { kind: "link", label, ...link } : { kind: "text", text: label });
    } else {
      const link = safeLink(bare);
      tokens.push(link ? { kind: "link", label: bare, ...link } : { kind: "text", text: whole });
    }
    last = index + whole.length;
  }
  const rest = text.slice(last);
  const open = streaming && allowBold ? rest.indexOf("**") : -1;
  if (open !== -1) {
    if (open > 0) tokens.push({ kind: "text", text: rest.slice(0, open) });
    const tail = rest.slice(open + 2);
    if (tail) tokens.push({ kind: "bold", children: [{ kind: "text", text: tail }] });
  } else if (rest) {
    tokens.push({ kind: "text", text: rest });
  }
  return tokens;
}

function tokenText(token: InlineToken): string {
  if (token.kind === "text") return token.text;
  if (token.kind === "link") return token.label;
  return token.children.map(tokenText).join("");
}

/** The text without markup, for the screen-reader announcement of a finished answer. */
export function toPlainText(text: string): string {
  const line = (value: string) => parseInline(value).map(tokenText).join("");
  return parseBlocks(text)
    .map((block) => (block.kind === "p" ? block.lines : block.items).map(line).join("\n"))
    .join("\n\n");
}
