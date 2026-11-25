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
  type ReactNode,
} from "react";
import { formatVoiceString, getVoiceStrings, VOICE_LANGUAGE_NAMES, type VoiceStrings } from "@/lib/voice/i18n";
import {
  VOICE_LANG_TAG,
  type DemoScript,
  type VoiceLocale,
  type VoiceMode,
  type VoicePublicConfig,
  type VoiceText,
} from "@/lib/voice/types";
import type { VoiceTransport } from "./transports/types";
import {
  canMute,
  initVoiceState,
  isActive,
  isLiveMode,
  isTalking,
  recoveryFor,
  TIMER_VISIBLE_FROM_SECONDS,
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

function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
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

function statusText(state: VoiceMachineState, strings: VoiceStrings): string {
  if (state.activeTool !== null && isTalking(state.status)) return strings.tools[state.activeTool];
  const base = strings.status[state.status];
  return state.muted && isActive(state.status) ? `${base} · ${strings.mutedStatus}` : base;
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

function Stage({ config, scripts = [], variant = "stage", contactUrl, headingLevel = 2 }: VoiceStageProps) {
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

  const locale = state.locale;
  const strings = useMemo(() => getVoiceStrings(locale), [locale]);
  const shownMode = state.status === "idle" ? mode : (state.mode ?? mode);
  const localeScripts = useMemo(() => scripts.filter((script) => script.locale === locale), [scripts, locale]);
  const script = localeScripts.find((candidate) => candidate.id === scriptId) ?? localeScripts[0] ?? null;
  const localeOptions = shownMode === "scripted" ? scriptLocales : config.locales;

  const rootRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const consentRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const recoveryRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<VoiceTransport | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Bumped by every start, reset and end: a chunk that arrives late for an old attempt is ignored. */
  const attemptRef = useRef(0);
  const lastInputRef = useRef<Input>("voice");
  const intentRef = useRef(false);
  const previousStatusRef = useRef(state.status);

  const titleId = useId();
  const transcriptId = useId();
  const inputId = useId();
  const introId = useId();

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
      unsubscribeRef.current = transport.onEvent((event) => dispatch(event));
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

  // Escape ends a running conversation wherever focus is (a live microphone is not something to
  // hunt a button for). Escapes already handled elsewhere (the chat panel) arrive prevented.
  const status = state.status;
  useEffect(() => {
    if (!isActive(status)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      if (status === "consent") cancelConsent();
      else endConversation();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [status, cancelConsent, endConversation]);

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
  const restart = (nextMode: VoiceMode, input: Input) => {
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
      chosen = candidates.find((candidate) => candidate.id === scriptId) ?? candidates[0] ?? null;
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
  const typedField = state.mode === "local" && (state.status === "connecting" || talking);
  useLayoutEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === status) return;
    const root = rootRef.current;
    if (status === "consent") {
      consentRef.current?.focus();
    } else if (previous === "consent" && status === "idle") {
      primaryRef.current?.focus();
    } else if (previous === "consent" && focusIsOurs(root)) {
      // The consent card is gone: the typed field when typing, else the end button.
      (state.typed ? inputRef.current : primaryRef.current)?.focus();
    } else if (status === "error" && focusIsOurs(root)) {
      // The first way forward; a disabled retry (counting down) is skipped.
      recoveryRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();
    }
  }, [status, state.typed]);

  // Recognition gave up mid-call: the field takes over, so put the caret there.
  const typed = state.typed;
  useEffect(() => {
    if (typed && typedField && focusIsOurs(rootRef.current)) inputRef.current?.focus();
  }, [typed, typedField]);

  // ----- Render -----------------------------------------------------------------------------------
  if (firstMode === null) return null;

  const tag = VOICE_LANG_TAG[locale];
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const assistantTitle =
    capitalize(pickText(config.assistantName, locale, config.locale)) ||
    formatVoiceString(strings.assistantFallback, { business: config.businessName });
  const modeLabel =
    shownMode === "scripted" ? strings.modeScripted : shownMode === "local" ? strings.modeLocal : strings.modeRealtime;
  const privacyHref = safeHref(pickText(config.privacyUrl, locale, config.locale));
  const contactHref = safeHref(contactUrl);
  const callerLabel = state.mode === "scripted" || (state.status === "idle" && mode === "scripted") ? strings.roleCaller : strings.roleYou;
  const minutes = Math.max(1, Math.ceil(state.limits.maxCallSeconds / 60));
  const startLabel = mode === "scripted" ? strings.startScripted : strings.start;
  const visibleCount = variant === "compact" ? 2 : 3;
  const visibleCaptions = state.captions.slice(-visibleCount);
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
  const onPrimary = () => {
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

  const errorMessage =
    state.errorCode !== null
      ? `${strings.errors[state.errorCode]}${
          LATER_CODES.has(state.errorCode) || (state.retryAfter !== null && state.retryAfter > 60) ? ` ${strings.tryLater}` : ""
        }`
      : "";

  const handoffText =
    state.handoff === null
      ? ""
      : state.handoff.kind === "transfer"
        ? formatVoiceString(strings.handoff.transfer, { target: state.handoff.targetLabel })
        : strings.handoff[state.handoff.kind];

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
      data-testid="voice-stage"
    >
      {/* The section is the size container; the layout inside reacts to its width, not the window's. */}
      <div className={styles.layout}>
      <div className={styles.head}>
        <p className={styles.kicker}>{modeLabel}</p>
        <Heading id={titleId} className={styles.title}>
          <span className={styles.titleText}>{assistantTitle}</span>
          <span className={styles.badge}>{strings.aiBadge}</span>
        </Heading>
        {config.kind === "demo" ? (
          <p className={styles.fictional}>{formatVoiceString(strings.fictional, { business: config.businessName })}</p>
        ) : null}
        {localeOptions.length > 1 ? (
          <LanguageSwitch
            locales={localeOptions}
            value={locale}
            label={strings.languageLabel}
            disabled={shownMode === "scripted" && isActive(status)}
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
            {statusText(state, strings)}
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

        {/* Always rendered, empty before the first line: a live region that appears together with
            its first text is often not read out. */}
        <div className={styles.captions} role="log" aria-live="polite" aria-label={strings.captionsLabel}>
          {visibleCaptions.map((caption) => (
            <CaptionLine
              key={`${caption.id}:${caption.final ? "f" : "i"}`}
              caption={caption}
              label={caption.role === "assistant" ? strings.roleAssistant : callerLabel}
            />
          ))}
        </div>

        {/* Always in the DOM: a live region inserted together with its text is often not read. */}
        <div className={styles.notice} aria-live="polite">
          {state.notice !== null ? <p>{strings.notices[state.notice]}</p> : null}
          {status === "ended" && state.endReason !== null ? <p className={styles.endNote}>{strings.ended[state.endReason]}</p> : null}
        </div>

        {status === "consent" && state.mode !== null ? (
          <div className={styles.card} role="group" aria-labelledby={`${titleId}-consent`}>
            <p id={`${titleId}-consent`} className={styles.cardTitle}>
              {strings.consentTitle}
            </p>
            <p className={styles.cardText}>{formatVoiceString(strings.consentText, { minutes })}</p>
            {state.mode === "local" ? <p className={styles.cardNote}>{strings.consentLocalNote}</p> : null}
            {state.mode === "local" && !hasRecognition() ? (
              <p className={styles.cardNote}>{strings.notices.recognition_unsupported}</p>
            ) : null}
            <div className={styles.actions}>
              {state.mode !== "local" || hasRecognition() ? (
                <button ref={consentRef} type="button" className={styles.primary} onClick={() => consent("voice")}>
                  {strings.consentAllow}
                </button>
              ) : null}
              {state.mode === "local" ? (
                <button
                  ref={hasRecognition() ? undefined : consentRef}
                  type="button"
                  className={styles.secondary}
                  onClick={() => consent("text")}
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

        {shownMode === "scripted" && (status === "idle" || status === "ended") && localeScripts.length > 1 ? (
          <div className={styles.scripts} role="group" aria-label={strings.examplesLabel}>
            {localeScripts.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={styles.scriptButton}
                aria-pressed={candidate.id === script?.id}
                lang={VOICE_LANG_TAG[candidate.locale]}
                onClick={() => setScriptId(candidate.id)}
              >
                <span className={styles.scriptTitle}>{candidate.title}</span>
                <span className={styles.scriptShows}>{candidate.shows}</span>
              </button>
            ))}
          </div>
        ) : null}

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

        {typedField ? (
          <form className={styles.typed} onSubmit={submitTyped}>
            <label htmlFor={inputId} className={styles.srOnly}>
              {strings.typeLabel}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              className={styles.field}
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

        {state.captions.length > 0 ? (
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

      {/* The last 30 seconds, said once (the visible countdown itself is not announced). */}
      <div className={styles.srOnly} aria-live="polite">
        {showTimer ? formatVoiceString(strings.timeLeftAnnounce, { seconds: TIMER_VISIBLE_FROM_SECONDS }) : ""}
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
