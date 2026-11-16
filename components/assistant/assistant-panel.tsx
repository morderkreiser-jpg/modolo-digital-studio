"use client";

// The assistant panel: a lazily loaded chunk (see assistant-launcher.tsx). It stays mounted after
// the first open and is only hidden (inert) when closed, so an answer that is still streaming
// survives closing and reopening.
//
// Desktop: a non-modal dialog anchored above the launcher. Below 640px wide or 500px tall: a
// full-screen modal (aria-modal, focus trap, page scroll locked, height following the on-screen
// keyboard, Back closes it).
import Image from "next/image";
import {
  Component,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getStrings, type AssistantStrings } from "@/lib/assistant/i18n";
import { interpolate, LOCALE_NAMES, pickText } from "@/lib/assistant/localize";
import type { AssistantLocale, AssistantPublicConfig } from "@/lib/assistant/types";
import { Composer } from "./composer";
import { ContactLinks, readRegion, resolveContact } from "./contact-links";
import { AlertIcon, ArrowDownIcon, CloseIcon, NewChatIcon, QuoteIcon } from "./icons";
import { safeLink } from "./markdown";
import { QuoteForm } from "./quote-form";
import { RichText, type LinkContext } from "./rich-text";
import { useAssistant, type ChatMessage, type ChatNotice } from "./use-assistant";
import { useMediaQuery } from "./use-media-query";
import styles from "./assistant.module.css";

/**
 * Full screen on narrow screens and on short ones (phones in landscape, zoomed-in laptops), where
 * the floating panel has no room. Keep in sync with the full-screen media queries in
 * assistant.module.css and launcher.module.css.
 */
const MOBILE_QUERY = "(max-width: 639.98px), (max-height: 499.98px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Within this distance of the end the list counts as "at the bottom" and follows new text. */
const NEAR_BOTTOM_PX = 48;
/** The visual viewport below this share of the window height means the on-screen keyboard is up. */
const KEYBOARD_RATIO = 0.75;
const MAX_STARTERS = 4;
const REMAINING_NOTE_FROM = 3;
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';
/** Marks the history entry the full-screen panel adds, so that Back closes the chat. */
const HISTORY_KEY = "mdaChat";

/** Full screen on a touch device: focusing the textarea would pop the keyboard over the chat. */
function keyboardWouldCover(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches && window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/** The token of the panel's own history entry, when that entry is the current one. */
function currentHistoryToken(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return null;
  const token = (state as Record<string, unknown>)[HISTORY_KEY];
  return typeof token === "string" ? token : null;
}

export interface AssistantPanelProps {
  config: AssistantPublicConfig;
  open: boolean;
  /** id of the dialog element (the launcher's aria-controls). */
  panelId: string;
  /** Escape, the close button, or a same-site link followed on a small screen. */
  onClose: () => void;
  /** The visitor switched the assistant's language: the launcher relabels itself. */
  onLocaleChange: (locale: AssistantLocale) => void;
}

// ---------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------

function LanguageSwitch({
  locales,
  value,
  label,
  onChange,
}: {
  locales: AssistantLocale[];
  value: AssistantLocale;
  label: string;
  onChange: (locale: AssistantLocale) => void;
}) {
  // The site's "measure" detail: a gold tick slides along a hairline to the active language.
  const style = { "--mda-lang-index": Math.max(0, locales.indexOf(value)) } as CSSProperties;
  return (
    <div className={styles.languages} role="group" aria-label={label} style={style}>
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          className={styles.language}
          lang={code}
          aria-pressed={code === value}
          aria-label={LOCALE_NAMES[code].native}
          title={LOCALE_NAMES[code].native}
          onClick={() => onChange(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
      <span className={styles.languageTick} aria-hidden="true" />
    </div>
  );
}

function messageNote(message: ChatMessage, strings: AssistantStrings): string | null {
  if (message.excluded) return strings.messageExcluded;
  if (message.status === "stopped") return strings.answerStopped;
  if (message.status === "truncated") return strings.answerTruncated;
  if (message.status === "interrupted") return strings.answerInterrupted;
  return null;
}

const MessageBubble = memo(function MessageBubble({
  message,
  strings,
  linkContext,
}: {
  message: ChatMessage;
  strings: AssistantStrings;
  linkContext: LinkContext;
}) {
  const own = message.role === "user";
  const note = messageNote(message, strings);
  return (
    <div className={styles.message} data-role={message.role} data-excluded={message.excluded || undefined}>
      <div className={styles.bubble}>
        <span className={styles.srOnly}>{own ? strings.youLabel : strings.assistantLabel} </span>
        {own ? (
          <p className={styles.userText}>{message.text}</p>
        ) : (
          <RichText text={message.text} streaming={message.status === "streaming"} context={linkContext} />
        )}
      </div>
      {note ? <p className={styles.messageNote}>{note}</p> : null}
    </div>
  );
});

function RetryButton({
  seconds,
  strings,
  onRetry,
}: {
  seconds: number | null;
  strings: AssistantStrings;
  onRetry: () => void;
}) {
  // Counts down a Retry-After; the parent remounts this per notice (keyed), so it starts fresh.
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
    <button type="button" className={styles.secondaryButton} onClick={onRetry} disabled={waiting}>
      {waiting ? interpolate(strings.retryIn, { seconds: left }) : strings.retry}
    </button>
  );
}

function noticeText(notice: ChatNotice, strings: AssistantStrings): string {
  if (notice.code === "network") return strings.networkError;
  if (notice.code === "offline") return strings.offline;
  if (notice.code === "client_timeout") return strings.clientTimeout;
  const text = strings.chatErrors[notice.code];
  // A long Retry-After gets no countdown; say plainly that it is for later.
  return !notice.retryable && notice.retryAfter !== null ? `${text} ${strings.tryLater}` : text;
}

// ---------------------------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------------------------

function trapTab(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function Panel({ config, open, panelId, onClose, onLocaleChange }: AssistantPanelProps) {
  const chat = useAssistant(config);
  const { state } = chat;
  const locale = chat.locale;
  const strings = useMemo(() => getStrings(locale, config.strings), [locale, config.strings]);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  // The client-only chunk can read the region cookie while initialising (no hydration involved).
  const [region] = useState(() => readRegion(config));
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [unseenFrom, setUnseenFrom] = useState<string | null>(null);

  const titleId = useId();
  const confirmTextId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const newChatRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const handledFormRef = useRef({ key: 0, focusToken: 0 });
  // `pinned` for code outside React's render cycle (the resize observer); kept in step with
  // every change of the state, synchronously.
  const pinnedRef = useRef(true);
  // Token of the history entry the full-screen panel added (null: none of ours is pending).
  const historyEntryRef = useRef<string | null>(null);

  const closeOnSmallScreen = useCallback(() => {
    // Full screen, the panel would hide the page the visitor just navigated to. The link's own
    // navigation follows: going back in history here would race it, so the entry just stays.
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    historyEntryRef.current = null;
    onClose();
  }, [onClose]);
  // WhatsApp links the model writes carry the same prefilled text as the panel's own contact
  // links: it is the only way to tell chats that started here apart (WhatsApp sends no referrer).
  const whatsappPrefill = pickText(resolveContact(config, region).whatsapp?.prefill, locale, config.locale);
  const linkContext = useMemo<LinkContext>(
    () => ({
      newTabLabel: strings.opensInNewTab,
      onNavigate: closeOnSmallScreen,
      whatsappPrefill: whatsappPrefill || undefined,
    }),
    [strings.opensInNewTab, closeOnSmallScreen, whatsappPrefill],
  );

  useEffect(() => {
    onLocaleChange(locale);
  }, [locale, onLocaleChange]);

  // The closing animation only makes sense once the panel has been seen: if the visitor closed
  // the launcher while this chunk was still loading, the first render is closed and must not
  // flash. React does not manage this attribute, so it simply stays once set.
  useEffect(() => {
    if (open) rootRef.current?.setAttribute("data-seen", "");
  }, [open]);

  // Focus the composer on open. Full screen on a touch device focus the dialog instead: popping
  // the keyboard right away would cover the welcome text and the suggested questions.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input && !input.readOnly && !keyboardWouldCover()) input.focus({ preventScroll: true });
      else rootRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Back (button or gesture) with the chat full screen should close the chat, not leave the
  // page. While it is open full screen, one same-URL history entry is ours (native pushState
  // integrates with the Next router): Back pops it and closes the chat.
  useEffect(() => {
    if (!open || !mobile) return;
    let token = historyEntryRef.current;
    if (token === null || currentHistoryToken() !== token) {
      token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      window.history.pushState({ [HISTORY_KEY]: token }, "");
      historyEntryRef.current = token;
    }
    const ours = token;
    const onPopState = () => {
      if (historyEntryRef.current !== ours || currentHistoryToken() === ours) return;
      // Our entry is gone (Back): close, with nothing left to undo.
      historyEntryRef.current = null;
      onClose();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, mobile, onClose]);

  // Closed any other way (close button, Escape, the launcher) while our entry is still the
  // current one: take it off again, so the next Back is not a dead press.
  useEffect(() => {
    if (open) return;
    const token = historyEntryRef.current;
    historyEntryRef.current = null;
    if (token !== null && currentHistoryToken() === token) window.history.back();
  }, [open]);

  // Full-screen modal: the page behind must not scroll.
  useEffect(() => {
    if (!open || !mobile) return;
    const html = document.documentElement;
    const body = document.body;
    const previous = [html.style.overflow, body.style.overflow] as const;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous[0];
      body.style.overflow = previous[1];
    };
  }, [open, mobile]);

  // Full-screen modal: fit the visible viewport, so the composer stays above the keyboard.
  useEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;
    if (!open || !mobile || !root || !viewport) return;
    let frame = 0;
    const reset = () => {
      root.style.removeProperty("--mda-vv-height");
      root.style.removeProperty("--mda-vv-top");
      root.removeAttribute("data-keyboard");
    };
    const apply = () => {
      frame = 0;
      // Pinch-zoom shrinks the visual viewport too: then the panel keeps its full height and is
      // magnified (and panned) with the page, instead of shrinking into the zoomed-in area.
      if (Math.abs(viewport.scale - 1) > 0.01) {
        reset();
        return;
      }
      root.style.setProperty("--mda-vv-height", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--mda-vv-top", `${Math.round(viewport.offsetTop)}px`);
      // The on-screen keyboard is up: the panel sheds its secondary lines (see the CSS).
      root.toggleAttribute("data-keyboard", viewport.height < window.innerHeight * KEYBOARD_RATIO);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      reset();
    };
  }, [open, mobile]);

  // A list that shrinks fires no scroll event (keyboard opening, composer growing, window
  // resized): keep the newest text in view while the visitor is following along.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (confirmingReset) confirmRef.current?.focus();
  }, [confirmingReset]);

  // Follow new content while the visitor is at the bottom. A freshly offered form is scrolled
  // to its top instead (its end is the submit button, the wrong first thing to show).
  const lastMessage = state.messages[state.messages.length - 1];
  const exhausted = chat.exhausted;
  const contentVersion = [
    state.messages.length,
    lastMessage?.text.length ?? 0,
    state.status === "waiting" ? "w" : "",
    state.notice?.id ?? 0,
    state.form?.key ?? 0,
    exhausted ? "x" : "",
  ].join(":");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const form = state.form;
    const handled = handledFormRef.current;
    handledFormRef.current = { key: form?.key ?? 0, focusToken: form?.focusToken ?? 0 };
    const requested = form !== null && form.focusToken !== 0 && form.focusToken !== handled.focusToken;
    const appeared = form !== null && form.key !== handled.key;
    // The ref, not the state: right after a card scroll it is already up to date (see below).
    const following = pinnedRef.current;
    const card = requested || (appeared && following) ? list.querySelector<HTMLElement>("[data-quote-card]") : null;
    if (card) {
      list.scrollTop = Math.max(0, card.offsetTop - 12);
      // Away from the end on purpose: a resize or the next update must not pull the list back
      // down past the card's first field.
      pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_PX;
      if (requested) {
        card
          .querySelector<HTMLElement>('input:not([tabindex="-1"]), select, textarea')
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (following) list.scrollTop = list.scrollHeight;
  }, [contentVersion, pinned, open, state.form, locale]);

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_PX;
    pinnedRef.current = atBottom;
    if (atBottom === pinned) return;
    setPinned(atBottom);
    setUnseenFrom(atBottom ? null : contentVersion);
  };

  /** Follow the conversation's end again (after the visitor sent something or started over). */
  const follow = () => {
    pinnedRef.current = true;
    setPinned(true);
  };

  const scrollToEnd = () => {
    const list = listRef.current;
    if (!list) return;
    // The pill goes away once the list reaches the end: hand focus to the list first, so it does
    // not fall back to <body> (where Escape and the focus trap no longer reach the panel).
    list.focus({ preventScroll: true });
    list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const showPill = !pinned && unseenFrom !== null && unseenFrom !== contentVersion;

  // When the control the visitor used disappears (a starter chip, the form, a notice), keep
  // focus in the conversation rather than letting it fall back to <body>.
  const focusComposer = useCallback(() => {
    const input = inputRef.current;
    if (input && !input.readOnly && !keyboardWouldCover()) input.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  }, []);

  const closeForm = chat.closeForm;
  const dismissForm = useCallback(() => {
    closeForm();
    focusComposer();
  }, [closeForm, focusComposer]);

  const send = (text: string, honeypot = "") => {
    follow();
    chat.send(text, honeypot);
  };

  const retry = () => {
    follow();
    chat.retry();
    focusComposer();
  };

  const startOver = () => {
    chat.reset();
    setConfirmingReset(false);
    follow();
    focusComposer();
  };

  const requestReset = () => {
    if (state.messages.length === 0) startOver();
    else setConfirmingReset(true);
  };

  const cancelReset = () => {
    setConfirmingReset(false);
    newChatRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      // Handled here: marked for the launcher's page-wide Escape listener (which skips prevented
      // events) and kept away from the host page's own Escape handlers (menus, dropdowns).
      event.preventDefault();
      event.stopPropagation();
      if (confirmingReset) cancelReset();
      else onClose();
      return;
    }
    if (event.key === "Tab" && mobile && open) trapTab(event, rootRef.current);
  };

  const assistantName = pickText(config.branding.assistantName, locale, config.locale) || config.branding.name;
  const welcome =
    pickText(config.welcome, locale, config.locale) ||
    interpolate(strings.welcomeFallback, { business: config.branding.name });
  const starters = (config.starters[locale] ?? []).slice(0, MAX_STARTERS);
  const hasUserMessage = state.messages.some((message) => message.role === "user");
  const logo = config.branding.logoUrl ? safeLink(config.branding.logoUrl) : null;
  const privacy = safeLink(pickText(config.privacyUrl, locale, config.locale));
  const canReset = state.messages.length > 0 || state.form !== null || state.notice !== null;
  const leadsOpen = config.leads.enabled && !state.leadSubmitted;
  // Shown even while a form is open: the model points visitors to this button, and with a form
  // already in the conversation a click scrolls back to it and focuses it (openForm, focusToken).
  const showQuoteChip = leadsOpen;
  const remaining = state.remaining;
  const remainingNote =
    remaining !== null && remaining > 0 && remaining <= REMAINING_NOTE_FROM
      ? remaining === 1
        ? strings.remainingOne
        : interpolate(strings.remainingMany, { count: remaining })
      : "";

  const contacts = (intro: boolean) => (
    <ContactLinks
      config={config}
      region={region}
      locale={locale}
      strings={strings}
      context={linkContext}
      intro={intro}
    />
  );

  // One flat, keyed list: the form card can move under a newer offer without losing input.
  const items: ReactNode[] = [
    <div key="welcome" className={styles.message} data-role="assistant">
      <div className={styles.bubble}>
        <RichText text={welcome} context={linkContext} />
      </div>
    </div>,
  ];
  if (!hasUserMessage && starters.length > 0) {
    items.push(
      <div key="starters" className={styles.starters} role="group" aria-label={strings.startersLabel}>
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            className={styles.chip}
            disabled={chat.busy || exhausted}
            onClick={() => {
              send(starter);
              focusComposer();
            }}
          >
            {starter}
          </button>
        ))}
      </div>,
    );
  }
  const formCard = state.form ? (
    <QuoteForm
      key={`form-${state.form.key}`}
      config={config}
      strings={strings}
      locale={locale}
      sessionId={state.sessionId}
      region={region}
      form={state.form}
      linkContext={linkContext}
      onDismiss={dismissForm}
      onSubmitted={chat.markLeadSubmitted}
    />
  ) : null;
  let formPlaced = formCard === null;
  if (formCard && state.form?.anchorId === null) {
    items.push(formCard);
    formPlaced = true;
  }
  for (const message of state.messages) {
    items.push(<MessageBubble key={message.id} message={message} strings={strings} linkContext={linkContext} />);
    if (!formPlaced && message.id === state.form?.anchorId) {
      items.push(formCard);
      formPlaced = true;
    }
  }
  if (!formPlaced) items.push(formCard);
  if (state.status === "waiting") {
    items.push(
      <div key="typing" className={styles.message} data-role="assistant" aria-hidden="true">
        <div className={`${styles.bubble} ${styles.typing}`}>
          <span />
          <span />
          <span />
        </div>
      </div>,
    );
  }
  if (state.notice) {
    const notice = state.notice;
    items.push(
      <div key={`notice-${notice.id}`} className={styles.notice} role="alert" data-testid="assistant-notice">
        <AlertIcon className={styles.noticeIcon} />
        <div className={styles.noticeBody}>
          <p>{noticeText(notice, strings)}</p>
          {notice.retryable || notice.suggestReset ? (
            <div className={styles.noticeActions}>
              {notice.retryable ? <RetryButton seconds={notice.retryAfter} strings={strings} onRetry={retry} /> : null}
              {notice.suggestReset ? (
                <button type="button" className={styles.secondaryButton} onClick={startOver}>
                  {strings.newConversation}
                </button>
              ) : null}
            </div>
          ) : null}
          {notice.showContacts ? contacts(true) : null}
        </div>
      </div>,
    );
  }
  if (exhausted && state.notice?.code !== "session_limit") {
    items.push(
      <div key="limit" className={styles.notice} data-tone="quiet">
        <div className={styles.noticeBody}>
          <p>{strings.limitReached}</p>
          {contacts(false)}
        </div>
      </div>,
    );
  }

  return (
    <div
      ref={rootRef}
      id={panelId}
      className={styles.panel}
      role="dialog"
      aria-modal={mobile && open ? true : undefined}
      aria-labelledby={titleId}
      data-open={open}
      data-testid="assistant-panel"
      data-lenis-prevent=""
      inert={!open}
      lang={locale}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {/* <div>, not <header>/<footer>: inside a dialog those would become page-level landmarks. */}
      <div className={styles.header}>
        <div className={styles.headerMain}>
          {/* Same-site logos go through the image optimizer (a 24px avatar, not the full file);
              remote ones stay as they are, since they would need images.remotePatterns. */}
          <span className={styles.avatar} aria-hidden="true">
            {logo && logo.target !== "direct" ? (
              <Image
                src={logo.href}
                alt=""
                width={24}
                height={24}
                unoptimized={logo.target !== "internal"}
                className={styles.avatarImage}
              />
            ) : (
              <span className={styles.avatarInitial}>{config.branding.name.charAt(0)}</span>
            )}
          </span>
          <div className={styles.titleBlock}>
            <h2 id={titleId} className={styles.title}>
              <span className={styles.titleText}>{assistantName}</span>
              <span className={styles.badge}>{strings.aiBadge}</span>
            </h2>
            <p className={styles.subtitle}>{strings.subtitle}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={strings.close}
            title={strings.close}
            data-testid="assistant-close"
          >
            <CloseIcon />
          </button>
        </div>
        <div className={styles.toolbar}>
          {config.locales.length > 1 ? (
            <LanguageSwitch
              locales={config.locales}
              value={locale}
              label={strings.languageLabel}
              onChange={chat.setLocale}
            />
          ) : (
            <span />
          )}
          <button
            ref={newChatRef}
            type="button"
            className={styles.toolButton}
            onClick={requestReset}
            disabled={!canReset}
            data-testid="assistant-new"
          >
            <NewChatIcon />
            <span>{strings.newConversation}</span>
          </button>
        </div>
        {confirmingReset ? (
          <div className={styles.confirm} role="group" aria-labelledby={confirmTextId}>
            <p id={confirmTextId}>{strings.confirmNewConversation}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghostButton} onClick={cancelReset}>
                {strings.cancel}
              </button>
              <button ref={confirmRef} type="button" className={styles.primaryButton} onClick={startOver}>
                {strings.confirmNewConversationYes}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.body}>
        <div
          ref={listRef}
          className={styles.list}
          onScroll={onListScroll}
          role="region"
          aria-label={strings.conversationLabel}
          tabIndex={0}
          data-testid="assistant-messages"
        >
          {items}
        </div>
        {showPill ? (
          <button type="button" className={styles.pill} onClick={scrollToEnd}>
            <ArrowDownIcon />
            <span>{strings.newMessages}</span>
          </button>
        ) : null}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerMeta} data-empty={showQuoteChip || remainingNote ? undefined : ""}>
          {showQuoteChip ? (
            <button type="button" className={styles.quoteChip} onClick={chat.openForm} data-testid="assistant-quote-chip">
              <QuoteIcon />
              <span>{strings.quoteChip}</span>
            </button>
          ) : null}
          {/* Always in the DOM, empty or not: a live region inserted together with its text is
              often not read out. */}
          <div className={styles.remaining} role="status" data-testid="assistant-remaining">
            {remainingNote}
          </div>
        </div>
        <Composer
          strings={strings}
          maxChars={config.limits.maxMessageChars}
          busy={chat.busy}
          disabled={exhausted}
          privacyHref={privacy && privacy.target !== "direct" ? privacy.href : null}
          linkContext={linkContext}
          inputRef={inputRef}
          onSend={send}
          onStop={chat.stop}
        />
      </div>

      {/* The answer that used up the session also says so (the limit notice itself is not live). */}
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {state.announcement ? (
          <p key={state.announcement.id}>
            {state.announcement.kind === "typing"
              ? strings.typing
              : exhausted
                ? `${state.announcement.text} ${strings.limitReached}`
                : state.announcement.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Error boundary: a bug in the widget must never take the host page down with it
// ---------------------------------------------------------------------------------------------

class PanelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Name only: an error message could quote conversation content.
    console.error(`[assistant] panel crashed: ${error instanceof Error ? error.name : typeof error}`);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PanelFallback({ config, open, panelId, onClose }: AssistantPanelProps) {
  const strings = getStrings(config.locale, config.strings);
  const textId = useId();
  return (
    <div
      id={panelId}
      className={styles.panel}
      role="dialog"
      aria-labelledby={textId}
      data-open={open}
      data-lenis-prevent=""
      inert={!open}
      lang={config.locale}
    >
      <div className={styles.fallback}>
        <p id={textId}>{strings.chatErrors.unavailable}</p>
        <ContactLinks
          config={config}
          region={config.defaultRegion}
          locale={config.locale}
          strings={strings}
          context={{ newTabLabel: strings.opensInNewTab }}
        />
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          {strings.close}
        </button>
      </div>
    </div>
  );
}

export default function AssistantPanel(props: AssistantPanelProps) {
  return (
    <PanelBoundary fallback={<PanelFallback {...props} />}>
      <Panel {...props} />
    </PanelBoundary>
  );
}
