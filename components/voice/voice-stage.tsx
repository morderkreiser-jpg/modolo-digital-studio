"use client";

// The voice widget: a dark espresso stage with one calm orb, captions, and the few controls a
// call needs. Rendered by components/voice/voice-mount.tsx with the public config only.
//
// What ships with the page: this shell, its strings and the start button. Everything heavy is a
// lazy chunk fetched when the stage scrolls into view or the visitor shows intent (pointer, focus,
// touch): the orb's animation loop, the transport of the chosen mode, the full transcript. Until
// the orb arrives a still CSS orb stands in.
//
// Nothing starts by itself. No audio context, no microphone and no API request before the
// visitor's click; a live mode asks for an explicit consent first, and the microphone is opened
// only from that consent click (some browsers unlock audio only inside a gesture).
//
// Everything is released on the end of a conversation, on page hide and on unmount: the
// transport stops recognition and synthesis, closes the audio context and tells the end endpoint
// (sendBeacon) when a live session was open.
import {
  Component,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { afterCallView, scriptIdOfCaption, type AfterCallView, type DemoAfterCall } from "@/lib/voice/after-call";
import { formatVoiceString, getVoiceStrings, VOICE_LANGUAGE_NAMES, type VoiceStrings } from "@/lib/voice/i18n";
import {
  VOICE_LANG_TAG,
  type DemoScript,
  type VoiceLocale,
  type VoiceMode,
  type VoicePublicConfig,
  type VoiceText,
  type VoiceToolName,
} from "@/lib/voice/types";
import { afterCallScrollTop, firstRequestSpan, MORE_BELOW_PX, type ContentSpan } from "./caption-scroll";
import { stageTitle } from "./stage-text";
import type { VoiceTransport } from "./transports/types";
import {
  activationAllowed,
  canMute,
  initVoiceState,
  isActive,
  isLiveMode,
  isTalking,
  recoveryFor,
  silenceWarningVisible,
  timerVisible,
  voiceReducer,
  type VoiceCaption,
  type VoiceEndReason,
  type VoiceFailureCode,
  type VoiceMachineState,
  type VoiceRecovery,
} from "./voice-machine";
import type { VoiceOrbProps } from "./voice-orb";
import type { VoiceTranscriptProps } from "./voice-transcript";
import styles from "./voice-stage.module.css";

export interface VoiceStageProps {
  config: VoicePublicConfig;
  /** Example conversations of this tenant; needed for the "scripted" mode. */
  scripts?: DemoScript[];
  /**
   * The page's language: every control, status and notice is written in it (review finding N3).
   * The conversation keeps its own language (state.locale), an example plays in its own, and
   * their texts carry their lang attribute. Omitted: the controls follow the conversation.
   */
  uiLocale?: VoiceLocale;
  /** What the business receives after each example, by script id (lib/voice/after-call.ts). */
  afterCalls?: Readonly<Record<string, DemoAfterCall>>;
  variant?: "stage" | "compact";
  /** Where "direct contact" leads. Omitted: the error card offers no contact link. */
  contactUrl?: string;
  /** Level of the stage's heading in the page outline. */
  headingLevel?: 2 | 3;
}

type Input = "voice" | "text";

// ---------------------------------------------------------------------------------------------
// Lazy chunks
// ---------------------------------------------------------------------------------------------

interface LazyChunk<T> {
  /** The loaded value, or null. */
  get: () => T | null;
  /** One shared request; dropped on failure so the next attempt retries. */
  load: () => Promise<T>;
}

function lazyChunk<T>(loader: () => Promise<T>): LazyChunk<T> {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    get: () => value,
    load: () => {
      if (value !== null) return Promise.resolve(value);
      pending ??= loader().then(
        (loaded) => {
          value = loaded;
          return loaded;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
  };
}

interface TransportArgs {
  config: VoicePublicConfig;
  locale: VoiceLocale;
  page: string;
  hp: string;
  input: Input;
  script: DemoScript | null;
}
type TransportFactory = (args: TransportArgs) => VoiceTransport | null;

const transportChunks: Record<VoiceMode, LazyChunk<TransportFactory>> = {
  scripted: lazyChunk(() =>
    import("./transports/scripted").then(
      (module): TransportFactory =>
        (args) =>
          args.script ? module.createScriptedTransport({ ...args, script: args.script }) : null,
    ),
  ),
  local: lazyChunk(() =>
    import("./transports/local").then((module): TransportFactory => (args) => module.createLocalTransport(args)),
  ),
  realtime: lazyChunk(() =>
    import("./transports/realtime").then((module): TransportFactory => (args) => module.createRealtimeTransport(args)),
  ),
};

const orbChunk = lazyChunk<ComponentType<VoiceOrbProps>>(() => import("./voice-orb").then((module) => module.default));
const transcriptChunk = lazyChunk<ComponentType<VoiceTranscriptProps>>(() =>
  import("./voice-transcript").then((module) => module.default),
);

function preload<T>(chunk: LazyChunk<T>): void {
  // A failed preload is not an error yet: the click retries and says so if it fails again.
  chunk.load().catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** The text for `locale`, else the tenant's language, else any; with the language it is in. */
function pickLocalized(
  text: VoiceText,
  locale: VoiceLocale,
  fallback: VoiceLocale,
): { text: string; locale: VoiceLocale } | null {
  for (const candidate of [locale, fallback, ...(Object.keys(text) as VoiceLocale[])]) {
    const value = text[candidate];
    if (value) return { text: value, locale: candidate };
  }
  return null;
}

function pickText(text: VoiceText, locale: VoiceLocale, fallback: VoiceLocale): string {
  return pickLocalized(text, locale, fallback)?.text ?? "";
}

/** Same-site paths and https links only: the config is ours, but a bad value must not become a javascript: link. */
function safeHref(href: string | undefined): string | null {
  const value = href?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function currentPath(): string {
  try {
    return window.location.pathname.slice(0, 200);
  } catch {
    return "";
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function hasRecognition(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

/** Focus is in the stage or nowhere in particular: moving it will not pull the visitor away. */
function focusIsOurs(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || (root !== null && root.contains(active));
}

/**
 * The focused control was just removed (it fell back to <body>), or focus was nowhere in
 * particular anyway: the stage must give it a place, or the next Tab starts at the top of the page.
 */
function focusWasDropped(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/** What the one primary button does right now; null while the consent card holds the buttons. */
type PrimaryRole = "start" | "end" | "again" | "reset" | null;

function primaryRoleOf(status: VoiceMachineState["status"]): PrimaryRole {
  if (status === "idle") return "start";
  if (status === "consent") return null;
  if (status === "ended") return "again";
  if (status === "error") return "reset";
  return "end";
}

/**
 * A tool's status stays on screen at least this long. Tools usually finish within milliseconds
 * (the "started" and "done" events then arrive in one render), and a status nobody can read does
 * not tell the caller that the request is being taken down.
 */
const TOOL_STATUS_MIN_MS = 1600;

function statusText(state: VoiceMachineState, strings: VoiceStrings, recentTool: VoiceToolName | null): string {
  if (state.activeTool !== null && isTalking(state.status)) return strings.tools[state.activeTool];
  // A tool that just ran, while the reply to it is prepared or spoken (not once it is the caller's turn).
  if (recentTool !== null && (state.status === "thinking" || state.status === "speaking")) return strings.tools[recentTool];
  const base = strings.status[state.status];
  return state.muted && isActive(state.status) ? `${base} · ${strings.mutedStatus}` : base;
}

/**
 * Where the caption box scrolls when a written example ends (caption-scroll.ts): the end mark and,
 * as far as the box allows, the first request of the e-mail, measured where it is laid out.
 */
function afterCallTop(box: HTMLElement, mark: HTMLElement): number {
  const origin = box.getBoundingClientRect().top - box.scrollTop;
  return afterCallScrollTop({
    endMark: mark.getBoundingClientRect().top - origin,
    request: firstRequestBox(box, origin),
    viewHeight: box.clientHeight,
    head: box.querySelector<HTMLElement>("[data-after-head]")?.getBoundingClientRect().height ?? 0,
  });
}

/**
 * The first request in the box's first e-mail, in the box's scroll coordinates, where it is laid
 * out: the card is measured as it starts to rise into place (mv-rise moves it down a few pixels),
 * so that offset is taken off. null if there is none.
 */
function firstRequestBox(box: HTMLElement, origin: number): ContentSpan | null {
  const card = box.querySelector<HTMLElement>("[data-after-call]");
  const text = card?.querySelector("[data-mail-body]")?.firstChild;
  if (!card || !text || text.nodeType !== Node.TEXT_NODE) return null;
  const span = firstRequestSpan(text.textContent ?? "");
  if (span === null) return null;
  try {
    const range = document.createRange();
    range.setStart(text, span.start);
    range.setEnd(text, span.end);
    const rect = range.getBoundingClientRect();
    const transform = getComputedStyle(card).transform;
    const rise = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
    return rect.height > 0 ? { top: rect.top - rise - origin, bottom: rect.bottom - rise - origin } : null;
  } catch {
    return null;
  }
}

/**
 * Faded edges of the caption box where lines are hidden above (data-scrolled) or below (data-more).
 * No faded top edge while the label of the e-mails is pinned there (data-pinned): the box has
 * scrolled past the top of the e-mail card, and the label is what says what the visitor reads.
 */
function markCaptionEdges(box: HTMLElement): void {
  box.toggleAttribute("data-scrolled", box.scrollTop > 0);
  box.toggleAttribute("data-more", box.scrollHeight - box.scrollTop - box.clientHeight > MORE_BELOW_PX);
  const card = box.querySelector<HTMLElement>("[data-after-call]");
  box.toggleAttribute("data-pinned", card !== null && card.getBoundingClientRect().top < box.getBoundingClientRect().top);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Codes where waiting a while is the honest advice. */
const LATER_CODES: ReadonlySet<VoiceFailureCode> = new Set(["rate_limited", "budget_exhausted"]);

// ---------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------

function LanguageSwitch({
  locales,
  value,
  label,
  disabled,
  onChange,
}: {
  locales: readonly VoiceLocale[];
  value: VoiceLocale;
  label: string;
  disabled: boolean;
  onChange: (locale: VoiceLocale) => void;
}) {
  // The site's "measure" detail, as in the chat widget: a gold tick slides under the active code.
  const style = { "--mv-lang-index": Math.max(0, locales.indexOf(value)) } as CSSProperties;
  return (
    <div className={styles.languages} role="group" aria-label={label} style={style}>
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          className={styles.language}
          lang={VOICE_LANG_TAG[code]}
          aria-pressed={code === value}
          aria-label={VOICE_LANGUAGE_NAMES[code]}
          title={VOICE_LANGUAGE_NAMES[code]}
          disabled={disabled}
          onClick={() => onChange(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
      <span className={styles.languageTick} aria-hidden="true" />
    </div>
  );
}

function RetryButton({
  seconds,
  strings,
  label,
  onRetry,
}: {
  seconds: number | null;
  strings: VoiceStrings;
  label: string;
  onRetry: () => void;
}) {
  // Counts down a Retry-After; keyed per error by the parent, so it starts fresh.
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const until = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const next = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  const waiting = left > 0;
  return (
    <button type="button" className={styles.secondary} onClick={onRetry} disabled={waiting}>
      {waiting ? formatVoiceString(strings.retryIn, { seconds: left }) : label}
    </button>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.icon} aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={styles.icon} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
      {muted ? <path d="M2.5 2.5l11 11" /> : null}
    </svg>
  );
}

/** A last word up to this long travels to the next line together with the badge. */
const BADGE_TAIL_MAX = 16;

function TitleWithBadge({ title, badge }: { title: string; badge: string }) {
  // The badge follows the title's last word, never alone on a line of its own: the two are kept
  // together (no wrap) when that word is short enough to never overflow a phone-wide stage.
  const cut = title.trimEnd().lastIndexOf(" ");
  const head = cut === -1 ? "" : title.slice(0, cut + 1);
  const tail = cut === -1 ? title : title.slice(cut + 1);
  return (
    <span className={styles.titleText}>
      {head}
      <span className={tail.length <= BADGE_TAIL_MAX ? styles.titleTail : undefined}>
        {tail}
        {/* Without a separator the heading's name runs the two together ("…BeispielhofKI"). A
            comma for the ear only (in the flow but transparent: taken out of the flow, as the
            usual visually-hidden text is, Chromium names it "Beispielhof , KI") and a real space,
            both kept on the line by the no-wrap span; together they are the badge's gap. */}
        <span className={styles.titleComma}>,</span>{" "}
        <span className={styles.badge}>{badge}</span>
      </span>
    </span>
  );
}

/**
 * What the business receives after a written example (afterCallView): the e-mails, labelled as an
 * example and in the business's language, or the note that it gets none. In the caption box (a
 * focusable group, so a keyboard can reach it and scroll the box) and in the full transcript.
 */
function AfterCall({
  view,
  strings,
  uiLocale,
  heading,
  focusable,
}: {
  view: AfterCallView;
  strings: VoiceStrings;
  uiLocale: VoiceLocale;
  /** The label's element: a heading one level under the stage's, or a paragraph in the transcript. */
  heading: "h3" | "h4" | "p";
  focusable: boolean;
}) {
  const labelId = useId();
  if (view.kind === "none") return <p className={styles.afterNone}>{strings.afterCallNone}</p>;
  const tag = VOICE_LANG_TAG[view.locale];
  const Label = heading;
  const mails = view.mails.map((mail, index) => (
    // Index keys: the list is fixed for one view and never reordered.
    <div key={index} className={styles.mail}>
      {mail.subject ? (
        <p className={styles.mailSubject}>
          <span className={styles.mailLabel}>{strings.afterCallSubject}</span>{" "}
          <span lang={tag}>{mail.subject}</span>
        </p>
      ) : null}
      {/* One text node: the stage finds the first request in it (caption-scroll.ts). */}
      <p className={styles.mailBody} lang={tag} data-mail-body="">
        {mail.text}
      </p>
    </div>
  ));
  return (
    <div className={styles.after} role="group" aria-labelledby={labelId} tabIndex={focusable ? 0 : undefined} data-after-call="">
      {/* The label: in the caption box it stays at the top edge while the e-mail scrolls under it
          (voice-stage.module.css, caption-scroll.ts). The note on the language scrolls away with
          the e-mail: pinned as well, the two took a third of the box on a small phone. */}
      <div className={styles.afterHead} data-after-head="">
        <Label id={labelId} className={styles.afterTitle}>
          {strings.afterCallTitle}
        </Label>
      </div>
      {view.locale !== uiLocale ? (
        <p className={styles.afterNote}>
          {formatVoiceString(strings.afterCallLanguage, { language: strings.languageNames[view.locale] })}
        </p>
      ) : null}
      {mails.length > 1 ? (
        <ol className={styles.mailList}>
          {mails.map((mail, index) => (
            <li key={index}>{mail}</li>
          ))}
        </ol>
      ) : (
        mails
      )}
    </div>
  );
}

function CaptionLine({ caption, label }: { caption: VoiceCaption; label: string }) {
  // Lines still being recognised or streamed are shown but not announced; the final line is a
  // new node (keyed by the parent), so the live region reads each line once, complete.
  return (
    <p className={styles.caption} data-role={caption.role} data-final={caption.final} aria-hidden={caption.final ? undefined : true}>
      <span className={styles.lineRole}>{label}</span>
      <span className={styles.lineText} lang={VOICE_LANG_TAG[caption.locale]}>
        {caption.text}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------------------------

function Stage({
  config,
  scripts = [],
  uiLocale: pageLocale,
  afterCalls,
  variant = "stage",
  contactUrl,
  headingLevel = 2,
}: VoiceStageProps) {
  // ----- What can run here ---------------------------------------------------------------------
  const canScript = config.modes.includes("scripted") && scripts.length > 0;
  const liveMode = config.modes.find((mode): mode is "local" | "realtime" => isLiveMode(mode)) ?? null;
  const firstMode = config.modes.find((mode) => mode !== "scripted" || canScript) ?? null;
  // Languages with an example, in the tenant's order, then any the tenant does not list.
  const scriptLocales = useMemo(() => {
    const have = new Set(scripts.map((script) => script.locale));
    return unique([...config.locales.filter((locale) => have.has(locale)), ...scripts.map((script) => script.locale)]);
  }, [config.locales, scripts]);
  const allLocales = useMemo(() => unique([...config.locales, ...scriptLocales]), [config.locales, scriptLocales]);
  const initialLocale =
    firstMode === "scripted" && !scriptLocales.includes(config.locale) ? (scriptLocales[0] ?? config.locale) : config.locale;

  const [state, dispatch] = useReducer(voiceReducer, null, () =>
    initVoiceState({ locale: initialLocale, locales: allLocales, limits: config.limits }),
  );
  /** The mode the next start uses (the chooser); the running conversation has its own in state.mode. */
  const [mode, setMode] = useState<VoiceMode | null>(firstMode);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [Orb, setOrb] = useState<ComponentType<VoiceOrbProps> | null>(null);
  const [Transcript, setTranscript] = useState<ComponentType<VoiceTranscriptProps> | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [draft, setDraft] = useState("");
  /** The last tool started, kept for TOOL_STATUS_MIN_MS (see statusText). */
  const [recentTool, setRecentTool] = useState<{ name: VoiceToolName; at: number } | null>(null);

  /** The conversation's language (or the example's): what is said, and what the transport hears. */
  const locale = state.locale;
  /** The language of the controls, statuses and notices: the page's (see VoiceStageProps.uiLocale). */
  const uiLocale = pageLocale ?? locale;
  const strings = useMemo(() => getVoiceStrings(uiLocale), [uiLocale]);
  const shownMode = state.status === "idle" ? mode : (state.mode ?? mode);
  const localeScripts = useMemo(() => scripts.filter((script) => script.locale === locale), [scripts, locale]);
  const script = localeScripts.find((candidate) => candidate.id === scriptId) ?? localeScripts[0] ?? null;
  const localeOptions = shownMode === "scripted" ? scriptLocales : config.locales;

  const rootRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const consentCardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const recoveryRef = useRef<HTMLDivElement>(null);
  const captionsRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const transportRef = useRef<VoiceTransport | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Bumped by every start, reset and end: a chunk that arrives late for an old attempt is ignored. */
  const attemptRef = useRef(0);
  const lastInputRef = useRef<Input>("voice");
  const intentRef = useRef(false);
  const previousStatusRef = useRef(state.status);
  /** What the primary button did at the last commit, and when that last changed (performance.now). */
  const primaryRoleRef = useRef<PrimaryRole>(primaryRoleOf(state.status));
  const roleChangedAtRef = useRef<number | null>(null);

  const titleId = useId();
  const transcriptId = useId();
  const inputId = useId();
  const introId = useId();
  const consentTextId = useId();
  const consentNoteId = useId();

  // ----- Lazy loading on intent ------------------------------------------------------------------
  const showIntent = useCallback(() => {
    if (intentRef.current) return;
    intentRef.current = true;
    orbChunk.load().then(
      (loaded) => setOrb(() => loaded),
      () => undefined, // the still orb stays: decorative only
    );
    if (mode !== null) preload(transportChunks[mode]);
  }, [mode]);

  // The orb never comes with the server render (no hydration mismatch); on a client navigation the
  // observer's first callback finds the chunk already loaded and swaps it in at once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          showIntent();
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [showIntent]);

  // ----- Transport lifecycle --------------------------------------------------------------------
  const release = useCallback((reason: VoiceEndReason) => {
    const transport = transportRef.current;
    transportRef.current = null;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    transport?.stop(reason);
  }, []);

  const launch = useCallback(
    (factory: TransportFactory, startMode: VoiceMode, input: Input, startLocale: VoiceLocale, chosen: DemoScript | null) => {
      release("user");
      const transport = factory({
        config,
        locale: startLocale,
        page: currentPath(),
        hp: honeypotRef.current?.value ?? "",
        input,
        script: startMode === "scripted" ? chosen : null,
      });
      if (transport === null) {
        dispatch({ type: "FAIL", code: "unsupported" });
        return;
      }
      transportRef.current = transport;
      unsubscribeRef.current = transport.onEvent((event) => {
        dispatch(event);
        if (event.type === "TOOL" && event.status === "started") setRecentTool({ name: event.name, at: Date.now() });
      });
      transport.start();
    },
    [config, release, dispatch],
  );

  /** Starts the transport of `startMode`, synchronously when its chunk is there (inside the click). */
  const begin = useCallback(
    (startMode: VoiceMode, input: Input, startLocale: VoiceLocale, chosen: DemoScript | null) => {
      const attempt = ++attemptRef.current;
      const chunk = transportChunks[startMode];
      const ready = chunk.get();
      if (ready) {
        launch(ready, startMode, input, startLocale, chosen);
        return;
      }
      chunk.load().then(
        (factory) => {
          if (attempt === attemptRef.current) launch(factory, startMode, input, startLocale, chosen);
        },
        () => {
          if (attempt === attemptRef.current) dispatch({ type: "FAIL", code: "load_failed" });
        },
      );
    },
    [launch, dispatch],
  );

  // A conversation that ended or failed lets go of everything at once.
  useEffect(() => {
    if (state.status === "ended") {
      attemptRef.current += 1;
      release(state.endReason ?? "user");
    } else if (state.status === "error") {
      attemptRef.current += 1;
      release("error");
    } else if (state.status === "idle" && transportRef.current !== null) {
      release("user");
    }
  }, [state.status, state.endReason, release]);

  useEffect(() => {
    if (recentTool === null) return;
    const timer = setTimeout(() => setRecentTool(null), TOOL_STATUS_MIN_MS);
    return () => clearTimeout(timer);
  }, [recentTool]);

  useEffect(() => {
    transportRef.current?.setMuted(state.muted);
  }, [state.muted]);

  useEffect(() => {
    transportRef.current?.setLocale(locale);
  }, [locale]);

  // The conversation clock: wall-clock seconds, robust against throttled timers in a background tab.
  const live = isLiveMode(state.mode);
  const talking = isTalking(state.status);
  useEffect(() => {
    if (!live || !talking) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - last) / 1000);
      if (seconds >= 1) {
        last += seconds * 1000;
        dispatch({ type: "TICK", seconds });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [live, talking, state.run]);

  // Leaving the page ends a live conversation: the microphone must not outlive the page.
  useEffect(() => {
    const onPageHide = () => {
      if (transportRef.current === null) return;
      attemptRef.current += 1;
      release("unload");
      dispatch({ type: "END", reason: "unload" });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [release]);

  useEffect(
    () => () => {
      attemptRef.current += 1;
      release("unload");
    },
    [release],
  );

  // ----- Actions ---------------------------------------------------------------------------------
  const cancelConsent = useCallback(() => {
    attemptRef.current += 1;
    dispatch({ type: "CANCEL" });
  }, [dispatch]);

  const endConversation = useCallback(() => {
    dispatch({ type: "END", reason: "user" });
  }, [dispatch]);

  // Escape ends a running conversation (or closes the consent card) when focus is inside the
  // stage. Not page-wide: the site's chat panel also closes on Escape from anywhere, and one key
  // press must never close one widget and end a call in the other. The stage keeps focus on its
  // own controls for the whole conversation (see the focus effect), so Escape is at hand. Marked
  // as handled, so the chat launcher's page-wide listener leaves it alone.
  const status = state.status;
  const onStageKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (!isActive(status)) return;
    event.preventDefault();
    if (status === "consent") cancelConsent();
    else endConversation();
  };

  // When the primary button (or the consent card) changes what it does, note the time: a click
  // that lands right after is the second half of a double-click, not a decision (activationAllowed).
  const primaryRole = primaryRoleOf(status);
  useLayoutEffect(() => {
    if (primaryRoleRef.current === primaryRole) return;
    primaryRoleRef.current = primaryRole;
    roleChangedAtRef.current = performance.now();
  }, [primaryRole]);
  const deliberate = (event: ReactMouseEvent<HTMLElement>): boolean => {
    const changedAt = roleChangedAtRef.current;
    // event.timeStamp is on the same clock as performance.now() (both count from the time origin).
    return activationAllowed(changedAt === null ? null : event.timeStamp - changedAt, event.detail);
  };

  const start = () => {
    if (mode === null) return;
    showIntent();
    if (mode === "scripted") {
      if (!script) return;
      dispatch({ type: "START", mode });
      begin("scripted", "voice", locale, script);
      return;
    }
    // Fetched now, while the visitor reads the consent: the consent click can then start the
    // transport synchronously, inside the gesture.
    preload(transportChunks[mode]);
    dispatch({ type: "START", mode });
  };

  const consent = (input: Input) => {
    if (state.status !== "consent" || state.mode === null) return;
    lastInputRef.current = input;
    dispatch({ type: "CONSENT", input });
    begin(state.mode, input, locale, null);
  };

  /** Starts again at once: the visitor already consented on this page. */
  const restart = (nextMode: VoiceMode, input: Input, nextScriptId: string | null = scriptId) => {
    release("user");
    dispatch({ type: "RESET" });
    setMode(nextMode);
    let startLocale = locale;
    let chosen = script;
    if (nextMode === "scripted") {
      if (!scriptLocales.includes(startLocale)) {
        startLocale = scriptLocales[0] ?? startLocale;
        dispatch({ type: "SET_LOCALE", locale: startLocale });
      }
      const candidates = scripts.filter((candidate) => candidate.locale === startLocale);
      chosen = candidates.find((candidate) => candidate.id === nextScriptId) ?? candidates[0] ?? null;
      if (!chosen) return;
    }
    dispatch({ type: "START", mode: nextMode });
    if (nextMode !== "scripted") {
      lastInputRef.current = input;
      dispatch({ type: "CONSENT", input });
    }
    begin(nextMode, input, startLocale, chosen);
  };

  const reset = () => {
    release("user");
    attemptRef.current += 1;
    dispatch({ type: "RESET" });
  };

  /**
   * Another example of this business. Before the start it is only chosen; while one plays, or
   * after it, the chosen one plays at once (the list stays where it is in both states, so the
   * stage keeps its height when an example ends).
   */
  const chooseScript = (id: string) => {
    setScriptId(id);
    if (state.mode !== "scripted" || (status !== "ended" && !(isActive(status) && status !== "consent"))) return;
    if (status !== "ended" && id === script?.id) return; // already playing
    restart("scripted", "voice", id);
  };

  const chooseMode = (next: VoiceMode) => {
    if (state.status !== "idle" || next === mode) return;
    setMode(next);
    if (intentRef.current) preload(transportChunks[next]);
    if (next === "scripted" && !scriptLocales.includes(locale) && scriptLocales[0]) {
      dispatch({ type: "SET_LOCALE", locale: scriptLocales[0] });
    }
  };

  const recover = (action: VoiceRecovery) => {
    const lastMode = state.mode ?? mode;
    if (action === "retry" || action === "new_conversation") {
      if (lastMode) restart(lastMode, lastInputRef.current);
    } else if (action === "type_instead") {
      restart("local", "text");
    } else if (action === "watch_example") {
      restart("scripted", "voice");
    }
  };

  const submitTyped = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const transport = transportRef.current;
    if (!transport || draft.trim() === "") return;
    if (transport.sendText(draft)) setDraft("");
  };

  const toggleTranscript = () => {
    if (transcriptOpen) {
      setTranscriptOpen(false);
      return;
    }
    setTranscriptOpen(true);
    setTranscriptFailed(false);
    if (Transcript) return;
    transcriptChunk.load().then(
      (loaded) => setTranscript(() => loaded),
      () => setTranscriptFailed(true),
    );
  };

  const getLevel = useCallback(() => transportRef.current?.getLevel() ?? 0, []);

  // ----- Focus ------------------------------------------------------------------------------------
  // Every change of state that removes the focused control gives focus a new place in the stage,
  // so keyboard and screen-reader users never land back at the top of the page.
  const typedField = state.mode === "local" && (state.status === "connecting" || talking);
  useLayoutEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === status) return;
    const root = rootRef.current;
    // The typed field when typing (it is there from "connecting" on), else the primary button.
    const conversationTarget = () => (state.typed && typedField ? inputRef.current : null) ?? primaryRef.current;
    if (status === "consent") {
      // The card itself, not its "allow" button: a screen reader reads its title and what the
      // visitor agrees to (aria-describedby) before any button can be pressed.
      consentCardRef.current?.focus();
    } else if (previous === "consent" && status === "idle") {
      primaryRef.current?.focus();
    } else if (previous === "consent" && focusIsOurs(root)) {
      // The consent card is gone: the typed field when typing, else the end button.
      conversationTarget()?.focus();
    } else if (status === "error" && focusIsOurs(root)) {
      // The first way forward; a disabled retry (counting down) is skipped.
      recoveryRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();
    } else if ((status === "ended" || previous === "error") && focusWasDropped()) {
      // The conversation ended by itself (the typed field and the mute button are gone), or a
      // recovery button of the error card started again (the card is gone). The primary button
      // stays and now reads "new conversation" or "end". No scrolling: the visitor may be
      // reading elsewhere on the page.
      conversationTarget()?.focus({ preventScroll: true });
    }
  }, [status, state.typed, typedField]);

  // During a conversation the captions are a box of fixed height that scrolls (see the render):
  // lines are only ever added below, and the box follows the newest one, unless the visitor has
  // scrolled up to read an earlier line. Only the box scrolls, never the page.
  const captions = state.captions;
  const reserveCaptions = isActive(status) && status !== "consent" ? true : status === "ended" && captions.length > 0;
  /** The box is (nearly) at its bottom: a new line scrolls it along. */
  const followRef = useRef(true);
  const onCaptionsScroll = useCallback(() => {
    const box = captionsRef.current;
    if (!box) return;
    followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    // Faded top edge only once earlier lines are above it, so the first line is never dimmed; a
    // faded bottom edge while more lies below, so the box shows that it scrolls.
    markCaptionEdges(box);
  }, []);
  useLayoutEffect(() => {
    followRef.current = true; // every new conversation starts at its first line
  }, [state.run]);

  // A written example that has stopped shows what the business receives (review finding N2): the
  // e-mails of the tool steps whose lines were shown. They go into the same box, after the last
  // line, so the stage keeps its height and nothing below it moves.
  const scriptedEnd = status === "ended" && state.mode === "scripted";
  const endReason = state.endReason;
  const afterView = useMemo((): AfterCallView | null => {
    if (!scriptedEnd || captions.length === 0) return null;
    const played = scriptIdOfCaption(captions[0].id);
    if (played === null) return null;
    return afterCallView(
      afterCalls?.[played],
      captions.map((caption) => caption.id),
      endReason === "complete",
    );
  }, [scriptedEnd, captions, afterCalls, endReason]);
  const endMarkRef = useRef<HTMLParagraphElement>(null);
  const showsAfter = afterView !== null;

  useLayoutEffect(() => {
    const box = captionsRef.current;
    if (!box || !reserveCaptions) return;
    if (followRef.current) {
      const mark = scriptedEnd && showsAfter ? endMarkRef.current : null;
      if (mark) {
        // The end of the example comes to the top of the box, just under its faded edge, and what
        // the business receives follows it; the box goes further when that keeps the first
        // request whole in view (caption-scroll.ts). Smooth, unless the visitor asked for less
        // motion (then the scroll event marks the edges as well).
        box.scrollTo({ top: afterCallTop(box, mark), behavior: prefersReducedMotion() ? "auto" : "smooth" });
      } else {
        box.scrollTop = box.scrollHeight;
      }
    }
    // A line added below a visitor who scrolled up, or a scroll that did not move: no scroll event.
    markCaptionEdges(box);
  }, [captions, reserveCaptions, scriptedEnd, showsAfter]);

  // Recognition gave up mid-call: the field takes over, so put the caret there.
  const typed = state.typed;
  useEffect(() => {
    if (typed && typedField && focusIsOurs(rootRef.current)) inputRef.current?.focus();
  }, [typed, typedField]);

  // The browser blocked the answer's sound: when focus is inside the stage, it moves to the
  // button that turns the sound on, so a keyboard or screen-reader visitor has it at hand.
  const notice = state.notice;
  useEffect(() => {
    if (notice !== "audio_blocked") return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (root !== null && active !== null && root.contains(active)) resumeRef.current?.focus();
  }, [notice]);
  // The sound came on: the button is gone, and with it the focus it had. Before the browser paints,
  // focus moves to the primary button (it ends the call; Escape works again), without scrolling.
  const previousNoticeRef = useRef(notice);
  useLayoutEffect(() => {
    const previous = previousNoticeRef.current;
    previousNoticeRef.current = notice;
    if (previous === "audio_blocked" && notice !== "audio_blocked" && focusWasDropped()) {
      primaryRef.current?.focus({ preventScroll: true });
    }
  }, [notice]);

  // ----- Render -----------------------------------------------------------------------------------
  if (firstMode === null) return null;

  const tag = VOICE_LANG_TAG[uiLocale];
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const SubHeading = headingLevel === 3 ? "h4" : "h3";
  // The title is part of the page: always in the page's language (stage-text.ts).
  const assistantTitle = stageTitle(config, uiLocale);
  const modeLabel =
    shownMode === "scripted" ? strings.modeScripted : shownMode === "local" ? strings.modeLocal : strings.modeRealtime;
  const privacyHref = safeHref(pickText(config.privacyUrl, uiLocale, config.locale));
  const contactHref = safeHref(contactUrl);
  const callerLabel = state.mode === "scripted" || (state.status === "idle" && mode === "scripted") ? strings.roleCaller : strings.roleYou;
  const minutes = Math.max(1, Math.ceil(state.limits.maxCallSeconds / 60));
  const startLabel = mode === "scripted" ? strings.startScripted : strings.start;
  // In the scrolling box (a conversation under way or just ended) every line; elsewhere the last few.
  const visibleCount = variant === "compact" ? 2 : 3;
  const visibleCaptions = reserveCaptions ? state.captions : state.captions.slice(-visibleCount);
  const showTimer = timerVisible(state);

  // One button that changes with the state (start → end → again), so keyboard focus stays on it
  // for the whole conversation. During the consent step the card has the buttons.
  const lastMode = state.mode ?? mode ?? firstMode;
  const primaryLabel =
    status === "idle"
      ? startLabel
      : status === "consent"
        ? null
        : status === "ended"
          ? lastMode === "scripted"
            ? strings.playAgain
            : strings.newConversation
          : status === "error"
            ? strings.newConversation
            : strings.end;
  const running = isActive(status) && status !== "consent";
  const onPrimary = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // A double-click on "play the example" must not end it with its second click.
    if (!deliberate(event)) return;
    if (status === "idle") start();
    else if (status === "ended") restart(lastMode, lastMode === "scripted" ? "voice" : lastInputRef.current);
    else if (status === "error") reset();
    else if (status !== "consent") endConversation();
  };

  const recoveries =
    status === "error" && state.errorCode !== null
      ? recoveryFor(state.errorCode, { mode: state.mode, hasScripts: canScript, hasContact: contactHref !== null })
      : [];

  const recoveryLabel: Record<VoiceRecovery, string> = {
    retry: strings.retry,
    new_conversation: strings.newConversation,
    type_instead: strings.typeInstead,
    watch_example: strings.watchExample,
    contact: strings.contact,
  };

  let preview: ReactNode = null;
  if (status === "idle" || status === "consent") {
    if (shownMode === "scripted" && script) {
      preview = (
        <div className={styles.preview} lang={VOICE_LANG_TAG[script.locale]}>
          <p className={styles.previewTitle}>{script.title}</p>
          <p className={styles.previewText}>{script.shows}</p>
        </div>
      );
    } else {
      const greeting = pickLocalized(config.greeting, locale, config.locale);
      if (greeting) {
        preview = (
          <div className={styles.preview}>
            <p className={styles.previewLabel}>{strings.greetingLabel}</p>
            <p className={styles.previewQuote} lang={VOICE_LANG_TAG[greeting.locale]}>
              {greeting.text}
            </p>
          </div>
        );
      }
    }
  }

  // A realtime call reads its own consent: the voice goes to the provider, and an example
  // business passes nothing on. Its length is the one the public config already caps for realtime.
  const realtime = state.mode === "realtime";
  const consentText = realtime
    ? formatVoiceString(config.kind === "demo" ? strings.consentTextRealtimeDemo : strings.consentTextRealtime, {
        minutes: Math.max(1, Math.ceil(config.limits.maxCallSeconds / 60)),
      })
    : formatVoiceString(strings.consentText, { minutes });
  const consentDescribedBy = state.mode === "local" || realtime ? `${consentTextId} ${consentNoteId}` : consentTextId;
  // While a realtime call runs, the microphone is open and the caller may speak over the
  // assistant: a screen reader reading captions or each turn aloud would be heard as the caller.
  // The captions stay visible (the transcript button reads them on demand), the status region
  // says "listening" once, and notices and alerts are read as always.
  const quietCaptions = realtime && status !== "idle" && status !== "consent";
  const quietStatus = realtime && talking;
  const shownStatus = statusText(state, strings, recentTool?.name ?? null);

  const errorText =
    state.errorCode === null
      ? ""
      : realtime && (state.errorCode === "mic_denied" || state.errorCode === "unsupported")
        ? strings.realtimeErrors[state.errorCode]
        : strings.errors[state.errorCode];
  const errorMessage =
    state.errorCode !== null
      ? `${errorText}${
          LATER_CODES.has(state.errorCode) || (state.retryAfter !== null && state.retryAfter > 60) ? ` ${strings.tryLater}` : ""
        }`
      : "";

  const handoffText =
    state.handoff === null
      ? ""
      : state.handoff.kind === "transfer"
        ? formatVoiceString(strings.handoff.transfer, { target: state.handoff.targetLabel })
        : strings.handoff[state.handoff.kind];

  // The other examples of this business. Before the start they come before the button (choose,
  // then play); from the start on they come after it, the same while one plays and after it ends,
  // so the stage does not grow when an example ends by itself and "play again" stays where it was.
  const scriptChooser =
    shownMode === "scripted" && localeScripts.length > 1 ? (
      <div className={styles.scripts} role="group" aria-label={strings.examplesLabel}>
        {localeScripts.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={styles.scriptButton}
            aria-pressed={candidate.id === script?.id}
            lang={VOICE_LANG_TAG[candidate.locale]}
            onClick={() => chooseScript(candidate.id)}
          >
            <span className={styles.scriptTitle}>{candidate.title}</span>
            <span className={styles.scriptShows}>{candidate.shows}</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <section
      ref={rootRef}
      className={styles.stage}
      data-variant={variant}
      data-status={status}
      data-mode={shownMode ?? undefined}
      lang={tag}
      aria-labelledby={titleId}
      onPointerEnter={showIntent}
      onFocus={showIntent}
      onTouchStart={showIntent}
      onKeyDown={onStageKeyDown}
      // A click on a caption or the background focuses the stage instead of <body>: Escape (handled
      // only inside the stage) keeps working mid-call. Never a tab stop.
      tabIndex={-1}
      data-testid="voice-stage"
    >
      {/* The section is the size container; the layout inside reacts to its width, not the window's. */}
      <div className={styles.layout}>
      <div className={styles.head}>
        <p className={styles.kicker}>{modeLabel}</p>
        <Heading id={titleId} className={styles.title}>
          <TitleWithBadge title={assistantTitle} badge={strings.aiBadge} />
        </Heading>
        {config.kind === "demo" ? (
          <p className={styles.fictional}>{formatVoiceString(strings.fictional, { business: config.businessName })}</p>
        ) : null}
        {localeOptions.length > 1 ? (
          <LanguageSwitch
            locales={localeOptions}
            value={locale}
            label={strings.languageLabel}
            disabled={(shownMode === "scripted" || state.mode === "realtime") && isActive(status)}
            onChange={(next) => dispatch({ type: "SET_LOCALE", locale: next })}
          />
        ) : null}
      </div>

      <div className={styles.visual}>
        <div className={styles.orbFrame} aria-hidden="true">
          {Orb ? (
            <Orb status={status} getLevel={getLevel} muted={state.muted} className={styles.orbCanvas} />
          ) : (
            <span className={styles.orbStill} />
          )}
        </div>
        <div className={styles.statusRow}>
          <p className={styles.status} role="status">
            <span className={styles.statusMark} aria-hidden="true" />
            {quietStatus ? (
              <>
                {/* Seen, not read out: a screen reader's voice would reach the open microphone. */}
                <span aria-hidden="true">{shownStatus}</span>
                <span className={styles.srOnly}>{strings.status.listening}</span>
              </>
            ) : (
              shownStatus
            )}
          </p>
          {showTimer && state.secondsLeft !== null ? (
            <p className={styles.timer} aria-hidden="true">
              {formatVoiceString(strings.timeLeft, { time: formatClock(state.secondsLeft) })}
            </p>
          ) : null}
        </div>
        {handoffText ? <p className={styles.handoff}>{handoffText}</p> : null}
      </div>

      <div className={styles.body}>
        {preview}

        {/* The box of lines. The log inside is always rendered, empty before the first line: a
            live region that appears together with its first text is often not read out. From the
            start of a conversation the box keeps a fixed height (data-reserve) and scrolls to its
            newest line, so the controls under it do not jump with every new line while the
            visitor may be reaching for "end". A written example ends inside the box too: its end,
            and what the business receives after it, take no room the box does not have. */}
        <div
          ref={captionsRef}
          className={styles.captions}
          data-reserve={reserveCaptions ? "" : undefined}
          data-empty={visibleCaptions.length === 0 && !scriptedEnd ? "" : undefined}
          onScroll={reserveCaptions ? onCaptionsScroll : undefined}
        >
          <div className={styles.log} role="log" aria-live={quietCaptions ? "off" : "polite"} aria-label={strings.captionsLabel}>
            {visibleCaptions.map((caption) => (
              <CaptionLine
                key={`${caption.id}:${caption.final ? "f" : "i"}`}
                caption={caption}
                label={caption.role === "assistant" ? strings.roleAssistant : callerLabel}
              />
            ))}
            {/* Read out once, politely, with the hint that the e-mails follow (they are not in the
                log: read out whole they would drown the end of the call). */}
            {scriptedEnd && endReason !== null ? (
              <p ref={endMarkRef} className={styles.endMark}>
                {strings.ended[endReason]}
                {afterView?.kind === "mails" ? (
                  <>
                    {" "}
                    <span className={styles.srOnly}>{strings.afterCallFollows}</span>
                  </>
                ) : null}
              </p>
            ) : null}
            {afterView?.kind === "none" ? (
              <AfterCall view={afterView} strings={strings} uiLocale={uiLocale} heading={SubHeading} focusable={false} />
            ) : null}
          </div>
          {afterView?.kind === "mails" ? (
            <AfterCall view={afterView} strings={strings} uiLocale={uiLocale} heading={SubHeading} focusable />
          ) : null}
        </div>

        {/* Always in the DOM: a live region inserted together with its text is often not read. */}
        <div className={styles.notice} aria-live="polite">
          {state.notice !== null ? (
            <p>
              {strings.notices[state.notice]}
              {state.notice === "audio_blocked" ? (
                <>
                  {" "}
                  {/* Playback may only be retried inside a gesture: this click is one. */}
                  <button
                    ref={resumeRef}
                    type="button"
                    className={styles.secondary}
                    onClick={() => transportRef.current?.resumeAudio?.()}
                  >
                    {strings.resumeAudio}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {/* Shortly before a long silence ends the call; any activity of the caller clears it. */}
          {silenceWarningVisible(state) ? <p>{strings.silenceWarning}</p> : null}
          {/* A written example says it in its box (above); a live conversation says it here. */}
          {status === "ended" && state.endReason !== null && !scriptedEnd ? (
            <p className={styles.endNote}>{strings.ended[state.endReason]}</p>
          ) : null}
        </div>

        {status === "consent" && state.mode !== null ? (
          // Focused as a whole when it appears (tabIndex -1): a screen reader announces its title
          // and the consent text (aria-describedby) before the visitor reaches any button.
          <div
            ref={consentCardRef}
            className={styles.card}
            role="group"
            tabIndex={-1}
            aria-labelledby={`${titleId}-consent`}
            aria-describedby={consentDescribedBy}
          >
            <p id={`${titleId}-consent`} className={styles.cardTitle}>
              {strings.consentTitle}
            </p>
            <p id={consentTextId} className={styles.cardText}>
              {consentText}
            </p>
            {state.mode === "local" ? (
              <p id={consentNoteId} className={styles.cardNote}>
                {strings.consentLocalNote}
              </p>
            ) : null}
            {state.mode === "realtime" ? (
              // For screen readers only: why the captions go quiet once the call runs.
              <p id={consentNoteId} className={styles.srOnly}>
                {strings.realtimeCaptionsNote}
              </p>
            ) : null}
            {state.mode === "local" && !hasRecognition() ? (
              <p className={styles.cardNote}>{strings.notices.recognition_unsupported}</p>
            ) : null}
            <div className={styles.actions}>
              {state.mode !== "local" || hasRecognition() ? (
                // Described by what it agrees to, also for a visitor who jumps straight to buttons.
                <button
                  type="button"
                  className={styles.primary}
                  aria-describedby={consentDescribedBy}
                  onClick={(event) => {
                    if (deliberate(event)) consent("voice");
                  }}
                >
                  {strings.consentAllow}
                </button>
              ) : null}
              {state.mode === "local" ? (
                <button
                  type="button"
                  className={styles.secondary}
                  aria-describedby={consentTextId}
                  onClick={(event) => {
                    if (deliberate(event)) consent("text");
                  }}
                >
                  {strings.consentTyped}
                </button>
              ) : null}
              <button type="button" className={styles.ghost} onClick={cancelConsent}>
                {strings.cancel}
              </button>
            </div>
          </div>
        ) : null}

        {status === "error" && state.errorCode !== null ? (
          <div className={styles.alert} role="alert">
            <p>{errorMessage}</p>
            <div ref={recoveryRef} className={styles.actions}>
              {recoveries.map((action) =>
                action === "contact" ? (
                  contactHref ? (
                    <a key={action} href={contactHref} className={styles.secondary}>
                      {recoveryLabel.contact}
                    </a>
                  ) : null
                ) : action === "retry" ? (
                  <RetryButton
                    key={`${action}-${state.run}`}
                    seconds={state.retryAfter !== null && state.retryAfter <= 60 ? state.retryAfter : null}
                    strings={strings}
                    label={recoveryLabel.retry}
                    onRetry={() => recover("retry")}
                  />
                ) : (
                  <button key={action} type="button" className={styles.secondary} onClick={() => recover(action)}>
                    {recoveryLabel[action]}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}

        {status === "idle" && liveMode !== null && canScript ? (
          <div className={styles.modes} role="group" aria-label={strings.modeChooserLabel}>
            <button type="button" className={styles.modeButton} aria-pressed={mode === liveMode} onClick={() => chooseMode(liveMode)}>
              {strings.modeChoiceLive}
            </button>
            <button type="button" className={styles.modeButton} aria-pressed={mode === "scripted"} onClick={() => chooseMode("scripted")}>
              {strings.modeChoiceScripted}
            </button>
          </div>
        ) : null}

        {status === "idle" ? scriptChooser : null}

        {status === "idle" ? (
          <p id={introId} className={styles.intro}>
            {shownMode === "scripted" ? strings.introScripted : formatVoiceString(strings.introLive, { start: strings.start })}
            {privacyHref ? (
              <>
                {" "}
                <a href={privacyHref} className={styles.inlineLink}>
                  {strings.privacyLink}
                </a>
              </>
            ) : null}
          </p>
        ) : null}

        {/* The field sits right under the conversation it continues; "end" follows it. */}
        {typedField ? (
          <form className={styles.typed} onSubmit={submitTyped}>
            <label htmlFor={inputId} className={styles.srOnly}>
              {strings.typeLabel}
            </label>
            {/* What is typed here is said in the conversation's language, not the page's: spell
                checking and screen readers follow lang (review finding typed-field-lang). The
                label, a control, stays in the page's language. */}
            <input
              ref={inputRef}
              id={inputId}
              className={styles.field}
              lang={VOICE_LANG_TAG[locale]}
              type="text"
              value={draft}
              maxLength={state.limits.maxTurnChars}
              placeholder={strings.typePlaceholder}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(event) => {
                setDraft(event.target.value);
                dispatch({ type: "ACTIVITY" });
              }}
            />
            <button type="submit" className={styles.send} aria-disabled={draft.trim() === "" || state.status === "thinking"}>
              {strings.send}
            </button>
          </form>
        ) : null}

        <div className={styles.controls}>
          {primaryLabel !== null ? (
            <button
              ref={primaryRef}
              type="button"
              className={status === "idle" || status === "ended" ? styles.primary : styles.secondary}
              onClick={onPrimary}
              disabled={status === "idle" && mode === "scripted" && !script}
              aria-label={running ? strings.endLabel : undefined}
              aria-describedby={status === "idle" ? introId : undefined}
              data-testid="voice-primary"
            >
              {running ? <StopIcon /> : null}
              {primaryLabel}
            </button>
          ) : null}
          {isLiveMode(state.mode) && !state.typed && (status === "connecting" || talking) ? (
            <button
              type="button"
              className={styles.secondary}
              aria-pressed={state.muted}
              disabled={!canMute(state)}
              onClick={() => dispatch({ type: "MUTE", muted: !state.muted })}
            >
              <MicIcon muted={state.muted} />
              {strings.mute}
            </button>
          ) : null}
        </div>

        {running || status === "ended" ? scriptChooser : null}

        {/* There from the start of a conversation, not from its first line: appearing later it
            would push the controls down once more. Empty, it says so. */}
        {running || state.captions.length > 0 ? (
          <div className={styles.transcriptBlock}>
            <button
              type="button"
              className={styles.ghost}
              aria-expanded={transcriptOpen}
              aria-controls={transcriptOpen ? transcriptId : undefined}
              onClick={toggleTranscript}
            >
              {transcriptOpen ? strings.transcriptHide : strings.transcriptShow}
            </button>
            {transcriptOpen ? (
              Transcript ? (
                <Transcript
                  id={transcriptId}
                  captions={state.captions}
                  title={strings.transcriptTitle}
                  empty={strings.transcriptEmpty}
                  assistantLabel={strings.roleAssistant}
                  callerLabel={callerLabel}
                  after={
                    afterView ? (
                      <AfterCall view={afterView} strings={strings} uiLocale={uiLocale} heading="p" focusable={false} />
                    ) : null
                  }
                />
              ) : (
                <p id={transcriptId} className={styles.transcriptEmpty}>
                  {transcriptFailed ? strings.errors.load_failed : strings.loading}
                </p>
              )
            ) : null}
          </div>
        ) : null}
      </div>
      </div>

      {/* The time left when the countdown appears, said once with the real number (the server can
          cut it short); the visible countdown itself is not announced. */}
      <div className={styles.srOnly} aria-live="polite">
        {showTimer && state.timerAnnounced !== null
          ? formatVoiceString(strings.timeLeftAnnounce, { seconds: state.timerAnnounced })
          : ""}
      </div>

      {/* Bot trap: off-screen, out of the tab order, hidden from assistive technology. */}
      <input ref={honeypotRef} className={styles.honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Error boundary: a bug in the widget must never take the host page down with it
// ---------------------------------------------------------------------------------------------

class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Name only: a message could quote what the visitor said.
    console.error(`[voice] stage crashed: ${error instanceof Error ? error.name : typeof error}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function VoiceStage(props: VoiceStageProps) {
  return (
    <StageBoundary>
      <Stage {...props} />
    </StageBoundary>
  );
}
