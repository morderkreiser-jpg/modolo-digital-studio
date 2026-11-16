// Renders assistant text (the markdown subset of markdown.ts) as React elements. Nothing is ever
// injected as HTML: every piece of text becomes a text node, and links are only created for
// targets that markdown.ts#safeLink accepts.
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { parseBlocks, parseInline, type InlineToken } from "./markdown";
import styles from "./assistant.module.css";

export interface LinkContext {
  /** Visually hidden suffix for links that open a new tab. */
  newTabLabel: string;
  /** Called when a same-site link is followed (the panel closes itself on small screens). */
  onNavigate?: () => void;
  /** Prefilled message for bare wa.me links in assistant text, as on the panel's own links. */
  whatsappPrefill?: string;
}

// A wa.me link exactly as the knowledge writes it: number only, no text of its own yet.
const BARE_WHATSAPP = /^https:\/\/wa\.me\/\d{6,15}$/;

export function SafeLink({
  href,
  target,
  context,
  className,
  children,
}: {
  href: string;
  target: "internal" | "external" | "direct";
  context: LinkContext;
  className?: string;
  children: ReactNode;
}) {
  if (target === "internal") {
    // Client-side navigation keeps the layout, so the open conversation survives the click.
    return (
      <Link href={href} prefetch={false} className={className} onClick={context.onNavigate}>
        {children}
      </Link>
    );
  }
  if (target === "direct") {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  const finalHref =
    context.whatsappPrefill && BARE_WHATSAPP.test(href)
      ? `${href}?text=${encodeURIComponent(context.whatsappPrefill)}`
      : href;
  return (
    <a href={finalHref} className={className} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={styles.srOnly}> {context.newTabLabel}</span>
    </a>
  );
}

function renderTokens(tokens: InlineToken[], context: LinkContext): ReactNode[] {
  return tokens.map((token, index) => {
    if (token.kind === "text") return <Fragment key={index}>{token.text}</Fragment>;
    if (token.kind === "bold") return <strong key={index}>{renderTokens(token.children, context)}</strong>;
    return (
      <SafeLink key={index} href={token.href} target={token.target} context={context} className={styles.inlineLink}>
        {token.label}
      </SafeLink>
    );
  });
}

export function RichText({
  text,
  streaming = false,
  context,
}: {
  text: string;
  streaming?: boolean;
  context: LinkContext;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={styles.rich}>
      {blocks.map((block, index) => {
        // Only the last block can hold an unfinished "**" while the answer streams in.
        const live = streaming && index === blocks.length - 1;
        if (block.kind === "p") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  {renderTokens(parseInline(line, live && lineIndex === block.lines.length - 1), context)}
                </Fragment>
              ))}
            </p>
          );
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {renderTokens(parseInline(item, live && itemIndex === block.items.length - 1), context)}
          </li>
        ));
        return block.kind === "ul" ? (
          <ul key={index}>{items}</ul>
        ) : (
          <ol key={index} start={block.start}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}

/**
 * Fills "{slot}" placeholders of a translated sentence with React nodes (e.g. a link inside the
 * consent text), so the link sits wherever the translation puts it.
 */
export function fillSlots(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template
    .split(/(\{\w+\})/)
    .filter((part) => part !== "")
    .map((part, index) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name !== undefined && Object.hasOwn(slots, name) ? (
        <Fragment key={index}>{slots[name]}</Fragment>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      );
    });
}
