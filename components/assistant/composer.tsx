// Message composer: auto-growing textarea (1 to 5 lines via CSS max-height), Enter to send,
// Shift+Enter for a new line, and a stop button while an answer is streaming.
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import type { AssistantStrings } from "@/lib/assistant/i18n";
import { interpolate } from "@/lib/assistant/localize";
import { SendIcon, StopIcon } from "./icons";
import { SafeLink, type LinkContext } from "./rich-text";
import styles from "./assistant.module.css";

/** The character counter appears from this share of the limit on. */
const COUNTER_THRESHOLD = 0.8;

export function Composer({
  strings,
  maxChars,
  busy,
  disabled,
  privacyHref,
  linkContext,
  inputRef,
  onSend,
  onStop,
}: {
  strings: AssistantStrings;
  maxChars: number;
  /** An answer is on its way: Enter does nothing and the send button becomes "stop". */
  busy: boolean;
  /** No more messages allowed in this session. */
  disabled: boolean;
  privacyHref: string | null;
  linkContext: LinkContext;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string, honeypot: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const honeypotRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const counterId = useId();
  const nearLimit = value.length >= Math.floor(maxChars * COUNTER_THRESHOLD);
  const canSend = !disabled && value.trim() !== "";

  // Grow with the content; the CSS max-height caps it at five lines and scrolls beyond.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [value, inputRef]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text, honeypotRef.current?.value ?? "");
    setValue("");
    // The send button turns into "stop": keep keyboard focus in the composer.
    inputRef.current?.focus({ preventScroll: true });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // keyCode 229: Safari reports the Enter that confirms an IME composition this way.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  const stop = () => {
    onStop();
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <form className={styles.composer} onSubmit={onSubmit} data-disabled={disabled || undefined}>
        <label className={styles.srOnly} htmlFor={inputId}>
          {strings.inputLabel}
        </label>
        {/* Read-only rather than disabled once the limit is reached: a disabled field drops the
            keyboard focus it holds to <body>, where Escape and the focus trap no longer work. */}
        <textarea
          ref={inputRef}
          id={inputId}
          className={styles.input}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={strings.inputPlaceholder}
          maxLength={maxChars}
          readOnly={disabled}
          aria-disabled={disabled || undefined}
          enterKeyHint="send"
          autoComplete="off"
          aria-describedby={nearLimit ? counterId : undefined}
          data-testid="assistant-input"
        />
        {/* Stop and Send are one <button> to React, so focus stays on it when the answer ends;
            hence aria-disabled, not disabled (submit() ignores an empty or blocked send). */}
        {busy ? (
          <button
            type="button"
            className={styles.stopButton}
            onClick={stop}
            aria-label={strings.stop}
            title={strings.stop}
            data-testid="assistant-stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            className={styles.sendButton}
            aria-disabled={!canSend || undefined}
            aria-label={strings.send}
            title={strings.send}
            data-testid="assistant-send"
          >
            <SendIcon />
          </button>
        )}
        {/* "_gotcha": a name no autofill profile maps to (a filled trap silently drops the message). */}
        <div className={styles.honeypot} aria-hidden="true">
          <label>
            {strings.form.honeypot}
            <input ref={honeypotRef} type="text" name="_gotcha" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
      </form>
      {nearLimit ? (
        <p id={counterId} className={styles.counter} data-full={value.length >= maxChars || undefined}>
          <span aria-hidden="true">
            {value.length}/{maxChars}
          </span>
          <span className={styles.srOnly}>{interpolate(strings.charCount, { count: value.length, max: maxChars })}</span>
        </p>
      ) : null}
      {/* On short screens the text shrinks to one line with an ellipsis; the privacy link stays. */}
      <p className={styles.disclaimer}>
        <span className={styles.disclaimerText}>{strings.disclaimer}</span>
        {privacyHref ? (
          <>
            <span aria-hidden="true">{"\u00a0·\u00a0"}</span>
            <SafeLink href={privacyHref} target="external" context={linkContext} className={styles.disclaimerLink}>
              {strings.privacy}
            </SafeLink>
          </>
        ) : null}
      </p>
    </>
  );
}
