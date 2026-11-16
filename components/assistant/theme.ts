// Widget theming: turns the tenant's branding into CSS custom properties on the widget root.
//
// Both palettes are emitted as raw tokens (--mda-light-*, --mda-dark-*); launcher.module.css maps
// the active one onto the --mda-* names from the data-theme attribute and, for "auto", from
// prefers-color-scheme. Choosing in CSS instead of JS means "auto" needs no media-query listener
// and the server-rendered launcher can never disagree with the client about the palette.
//
// The defaults ARE the Modolo look ("The Measure": cream paper, espresso ink, gold as line only),
// so a tenant only overrides what differs. Contrast (WCAG AA) of the defaults, measured:
// muted 5.5:1 on background, danger 6.5:1, accentText on accent 16.7:1; dark palette ≥ 6.5:1.
import type { CSSProperties } from "react";
import type { TenantBranding, ThemeColors, ThemeMode } from "@/lib/assistant/types";

export const LIGHT_COLORS: ThemeColors = {
  accent: "#17130e",
  accentText: "#f7f3ec",
  background: "#fbf8f2",
  surface: "#ffffff",
  text: "#17130e",
  muted: "#6e6458",
  line: "rgba(31, 27, 22, 0.12)",
  // Decorative gold (3:1 on cream): lines and small accents only. Text and focus rings use a
  // contrast-boosted mix of it with the text colour, derived in CSS.
  highlight: "#b5893f",
  danger: "#a3341f",
};

export const DARK_COLORS: ThemeColors = {
  accent: "#f3ede2",
  accentText: "#17130e",
  background: "#14110d",
  surface: "#1f1a14",
  text: "#f3ede2",
  muted: "#a89e8c",
  line: "rgba(243, 237, 226, 0.14)",
  highlight: "#c9a35a",
  danger: "#ec8a6e",
};

const TOKENS: ReadonlyArray<readonly [keyof ThemeColors, string]> = [
  ["accent", "accent"],
  ["accentText", "accent-text"],
  ["background", "bg"],
  ["surface", "surface"],
  ["text", "text"],
  ["muted", "muted"],
  ["line", "line"],
  ["highlight", "highlight"],
  ["danger", "danger"],
];

// These values end up in a style attribute that is also server-rendered, so anything able to
// close the declaration (";", braces, quotes in colours, angle brackets) is rejected outright.
const SAFE_COLOR = /^[#(),.%/\w\s-]{1,80}$/;
const SAFE_FONT = /^[\w\s,'"().-]{1,200}$/;

function pickColors(defaults: ThemeColors, overrides: Partial<ThemeColors> | undefined): ThemeColors {
  const colors = { ...defaults };
  if (!overrides) return colors;
  for (const [key] of TOKENS) {
    const value = overrides[key];
    if (typeof value === "string" && SAFE_COLOR.test(value.trim())) colors[key] = value.trim();
  }
  return colors;
}

function safeFont(value: string | undefined): string | undefined {
  const font = value?.trim();
  return font && SAFE_FONT.test(font) ? font : undefined;
}

export function themeMode(branding: TenantBranding): ThemeMode {
  return branding.theme === "dark" || branding.theme === "auto" ? branding.theme : "light";
}

/**
 * Inline style for the widget root: the palette(s) the mode can use plus the optional fonts.
 * Fonts are left unset when the tenant gives none, so the widget inherits the host page's type.
 */
export function themeStyle(branding: TenantBranding): CSSProperties {
  const mode = themeMode(branding);
  const style: Record<string, string> = {};
  if (mode !== "dark") {
    const light = pickColors(LIGHT_COLORS, branding.colors);
    for (const [key, name] of TOKENS) style[`--mda-light-${name}`] = light[key];
  }
  if (mode !== "light") {
    const dark = pickColors(DARK_COLORS, branding.darkColors);
    for (const [key, name] of TOKENS) style[`--mda-dark-${name}`] = dark[key];
  }
  const font = safeFont(branding.fontFamily);
  const heading = safeFont(branding.headingFontFamily) ?? font;
  if (font) style["--mda-font"] = font;
  if (heading) style["--mda-font-heading"] = heading;
  return style as CSSProperties;
}
