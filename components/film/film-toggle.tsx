"use client";

import { filmStore, isFilmRunning, useFilmState } from "./film-store";

type Props = {
  labels: { playing: string; notPlaying: string };
  className?: string;
  /** Classes for the text label (visually hidden on phones: the icon-only button keeps it as its name). */
  labelClassName?: string;
  iconClassName?: string;
};

/**
 * Pause / play for the hero film (WCAG 2.2.2). Always rendered, in the server HTML too, where it reads
 * «Film abspielen». A plain button whose label switches with the state: no aria-pressed (SPEC D23).
 */
export default function FilmToggle({ labels, className = "", labelClassName = "", iconClassName = "" }: Props) {
  const state = useFilmState();
  const running = isFilmRunning(state);

  return (
    <button
      type="button"
      className={className}
      data-film-toggle={running ? "running" : "stopped"}
      onClick={() => (running ? filmStore.pause() : filmStore.play())}
    >
      {running ? <PauseGlyph className={iconClassName} /> : <PlayGlyph className={iconClassName} />}
      {/* Both labels share one grid cell, so the button keeps the width of the longer one and the
          rail never shifts when the film starts (CLS 0). Only the visible one is part of the name. */}
      <span className={labelClassName} style={{ display: "inline-grid" }}>
        <Label text={labels.playing} on={running} />
        <Label text={labels.notPlaying} on={!running} />
      </span>
    </button>
  );
}

function Label({ text, on }: { text: string; on: boolean }) {
  return (
    <span
      data-label={on ? "" : undefined}
      aria-hidden={on ? undefined : true}
      style={{ gridArea: "1 / 1", visibility: on ? "visible" : "hidden" }}
    >
      {text}
    </span>
  );
}

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true" focusable="false">
      <path d="M2.6 1.3 10.6 6 2.6 10.7Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true" focusable="false">
      <path d="M2.4 1.4h2.6v9.2H2.4ZM7 1.4h2.6v9.2H7Z" fill="currentColor" />
    </svg>
  );
}
