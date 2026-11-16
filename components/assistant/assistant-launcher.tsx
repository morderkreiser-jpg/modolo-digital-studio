"use client";

// Floating launcher of the AI assistant: the only part of the widget in the initial bundle.
// Everything else (conversation, form, markdown, network code, strings tables) lives in the
// panel chunk, fetched on the first sign of intent (hover, focus, touch) and opened on click.
import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import type { AssistantLocale, AssistantPublicConfig } from "@/lib/assistant/types";
import type { AssistantPanelProps } from "./assistant-panel";
import { ChatIcon, CloseIcon } from "./icons";
import { themeMode, themeStyle } from "./theme";
import styles from "./launcher.module.css";

/** Launcher texts per locale, computed on the server so no strings table ships here. */
export interface LauncherLabels {
  open: string;
  close: string;
  loadError: string;
}

type PanelComponent = ComponentType<AssistantPanelProps>;

/** How long the "could not load" note stays up. */
const LOAD_ERROR_MS = 8_000;

// One shared request for the chunk, so preload and click never fetch twice. It is dropped on
// failure, so the next attempt (a later click) retries instead of replaying the error.
let panelChunk: Promise<PanelComponent> | null = null;

function loadPanel(): Promise<PanelComponent> {
  if (!panelChunk) {
    panelChunk = import("./assistant-panel").then(
      (module) => module.default,
      (error: unknown) => {
        panelChunk = null;
        throw error;
      },
    );
  }
  return panelChunk;
}

function preloadPanel() {
  // A failed preload is not an error yet: the click retries and tells the visitor if it fails.
  loadPanel().catch(() => undefined);
}

function lastSegment(pathname: string | null): string {
  const segment = (pathname ?? "").split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

export default function AssistantLauncher({
  config,
  labels,
}: {
  config: AssistantPublicConfig;
  labels: Record<AssistantLocale, LauncherLabels>;
}) {
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<PanelComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // The panel reports the language it speaks; before it exists, the page's language applies.
  const [panelLocale, setPanelLocale] = useState<AssistantLocale | null>(null);
  const locale = panelLocale ?? config.locale;
  const hidden = config.hiddenOnPathSegments.some((segment) => segment.toLowerCase() === lastSegment(pathname));
  const panelVisible = open && Panel !== null && !hidden;

  const close = useCallback(() => {
    restoreFocusRef.current = true;
    setOpen(false);
  }, []);

  // Closing from inside the panel (Escape, close button) hands focus back to the launcher.
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    buttonRef.current?.focus();
  }, [open]);

  // Escape closes the panel wherever focus is: the desktop panel is not modal, so focus may be
  // on the page behind it. Escapes the panel handles itself (e.g. cancelling "new chat") arrive
  // here with defaultPrevented.
  useEffect(() => {
    if (!panelVisible) return;
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) close();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [panelVisible, close]);

  // Lets the host page move its own floating controls out of the way while the panel is open
  // (components/back-to-top.tsx hides itself on html[data-assistant-open]).
  useEffect(() => {
    if (!panelVisible) return;
    const html = document.documentElement;
    html.setAttribute("data-assistant-open", "");
    return () => html.removeAttribute("data-assistant-open");
  }, [panelVisible]);

  useEffect(() => {
    if (!loadFailed) return;
    const timer = setTimeout(() => setLoadFailed(false), LOAD_ERROR_MS);
    return () => clearTimeout(timer);
  }, [loadFailed]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setLoadFailed(false);
    setOpen(true);
    if (Panel) return;
    setLoading(true);
    loadPanel().then(
      (component) => {
        setPanel(() => component);
        setLoading(false);
      },
      () => {
        setLoading(false);
        setOpen(false);
        setLoadFailed(true);
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      // Handled here: the document-level listener above skips it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (hidden) return null;

  const text = labels[locale] ?? labels[config.locale];

  return (
    <div className={styles.root} data-theme={themeMode(config.branding)} style={themeStyle(config.branding)}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.launcher}
        data-open={panelVisible}
        aria-haspopup="dialog"
        aria-expanded={panelVisible}
        aria-controls={Panel ? panelId : undefined}
        aria-label={panelVisible ? text.close : text.open}
        aria-busy={loading || undefined}
        title={panelVisible ? text.close : text.open}
        lang={locale}
        onClick={toggle}
        onKeyDown={onKeyDown}
        onPointerEnter={preloadPanel}
        onFocus={preloadPanel}
        onTouchStart={preloadPanel}
        data-testid="assistant-launcher"
      >
        <span className={styles.icon} data-icon="chat">
          <ChatIcon />
        </span>
        <span className={styles.icon} data-icon="close">
          <CloseIcon />
        </span>
      </button>
      {Panel ? (
        <Panel config={config} open={open} panelId={panelId} onClose={close} onLocaleChange={setPanelLocale} />
      ) : null}
      {loadFailed ? (
        <p className={styles.loadError} role="alert" lang={locale}>
          {text.loadError}
        </p>
      ) : null}
    </div>
  );
}
