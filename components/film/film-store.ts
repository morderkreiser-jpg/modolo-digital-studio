"use client";

import { useSyncExternalStore } from "react";

// One tiny store shared by the two film islands: <BackgroundFilm> (owns the <video>) and
// <FilmToggle> (the pause/play button, which lives elsewhere in the hero). One film per page.
//
// status   what the video is doing (SPEC §2.9):
//   idle         no <video> yet (SSR, hydration, blocked, waiting for load + 400 ms)
//   loading      <video> mounted, not playing yet
//   playing      the `playing` event fired
//   paused-auto  paused because the hero left the viewport or the tab is hidden (resumes on return)
//   paused-user  the visitor pressed «Film anhalten»
//   refused      play() was rejected (iOS Low Power Mode) or no source could be played
// intent   what the visitor asked for: auto (default), play (pressed «Film abspielen»), pause
//          (pressed «Film anhalten», remembered in localStorage "mds-film-paused").
// shot     index into FILM.shots of the last frame the <video> presented (null = none yet), read by the
//          live credit under the H1 (film-credit.tsx). It lives in its own sub-store with its own
//          listeners, so a cut re-renders only the credit, never the toggle (SPEC §2.5).

export type FilmStatus = "idle" | "loading" | "playing" | "paused-auto" | "paused-user" | "refused";
export type FilmIntent = "auto" | "play" | "pause";
export type FilmState = { readonly status: FilmStatus; readonly intent: FilmIntent };

const STORAGE_KEY = "mds-film-paused";
const SERVER_STATE: FilmState = { status: "idle", intent: "auto" };

let state: FilmState | null = null;
let video: HTMLVideoElement | null = null;
const listeners = new Set<() => void>();
let shot: number | null = null;
const shotListeners = new Set<() => void>();

function storedPause(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storePause(on: boolean) {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode / blocked storage: the choice simply is not remembered
  }
}

function get(): FilmState {
  if (!state) state = { status: "idle", intent: storedPause() ? "pause" : "auto" };
  return state;
}

function set(patch: Partial<FilmState>) {
  const prev = get();
  const next = { ...prev, ...patch };
  if (next.status === prev.status && next.intent === prev.intent) return;
  state = next;
  listeners.forEach((l) => l());
  // A refused film shows the poster again, so the credit goes back to the poster's shot.
  if (next.status === "refused") setShot(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setShot(next: number | null) {
  if (next === shot) return;
  shot = next;
  shotListeners.forEach((l) => l());
}

// Module scope: a stable identity, so useSyncExternalStore never resubscribes.
function subscribeShot(listener: () => void) {
  shotListeners.add(listener);
  return () => {
    shotListeners.delete(listener);
  };
}

/** AbortError = a pause() interrupted the play() request: not a refusal. */
export function onPlayRejected(err: unknown) {
  if (err instanceof DOMException && err.name === "AbortError") return;
  set({ status: "refused" });
}

export const filmStore = {
  get,
  setStatus(status: FilmStatus) {
    set({ status });
  },
  attach(el: HTMLVideoElement) {
    video = el;
    const s = get().status;
    if (s === "idle" || s === "refused") set({ status: "loading" });
  },
  detach(el: HTMLVideoElement) {
    if (video !== el) return;
    video = null;
    // A remount (orientation flip) starts a new <video> from 0: until it presents a frame the poster's
    // shot is the true one.
    setShot(null);
  },
  /** Called for every presented frame (background-film.tsx): the index of its shot in FILM.shots. */
  setShot(index: number) {
    setShot(index);
  },
  /** The visitor pressed «Film abspielen». Runs inside the click handler, so play() keeps the user gesture. */
  play() {
    storePause(false);
    const s = get().status;
    set({ intent: "play", status: s === "refused" ? (video ? "loading" : "idle") : s });
    if (video) video.play().catch(onPlayRejected);
  },
  /** The visitor pressed «Film anhalten». */
  pause() {
    storePause(true);
    set({ intent: "pause", status: video ? "paused-user" : get().status });
    video?.pause();
  },
};

export function useFilmState(): FilmState {
  return useSyncExternalStore(subscribe, get, () => SERVER_STATE);
}

/** The shot on screen: the last presented frame's, or `posterShot` (SSR, hydration, no video, refused). */
export function useFilmShot(posterShot: number): number {
  return useSyncExternalStore(subscribeShot, () => shot ?? posterShot, () => posterShot);
}

/** The toggle reads «Film anhalten» only while the film is running (or auto-paused off-screen). */
export function isFilmRunning(s: FilmState): boolean {
  return s.status === "playing" || s.status === "paused-auto";
}
