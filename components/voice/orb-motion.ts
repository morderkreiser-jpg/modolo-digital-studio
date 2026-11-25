// What the orb looks like in each state and how fast its animation loop has to run. Pure, no
// canvas and no React, so the pacing rules are unit-tested (tests/voice/transport.test.ts):
//   full  listening, thinking, speaking, the start of a conversation, any transition in progress
//   slow  idle, once the look has settled: only the slow breathing moves (a few frames a second
//         are enough for a 6.4-second breath)
//   stop  ended or error, once the look has settled: nothing moves, so nothing is drawn
//   still reduced motion: one frame per state, redrawn on state changes only
import type { VoiceStatus } from "./voice-machine";

/** What the frame looks like; every field eases towards the state's target. */
export interface Look {
  /** Corona brightness, 0..1. */
  glow: number;
  /** Corona reach, in disc radii. */
  reach: number;
  /** Gold ring opacity. */
  ring: number;
  /** How far the ticks follow the level (listening only). */
  ticks: number;
  /** Opacity of the travelling glint. */
  glint: number;
  /** Turns per second of the glint. */
  spin: number;
  /** Rim light on the disc's edge. */
  rim: number;
}

export function targetLook(status: VoiceStatus, level: number, muted: boolean): Look {
  switch (status) {
    case "listening":
      return { glow: 0.5, reach: 1.62, ring: 0.62, ticks: muted ? 0 : 1, glint: 0, spin: 0.08, rim: 0.5 };
    case "thinking":
      return { glow: 0.42, reach: 1.55, ring: 0.5, ticks: 0, glint: 1, spin: 0.22, rim: 0.42 };
    case "speaking":
      return { glow: 0.55 + 0.45 * level, reach: 1.6 + 0.32 * level, ring: 0.46, ticks: 0, glint: 0, spin: 0.08, rim: 0.55 + 0.35 * level };
    case "consent":
    case "requesting_mic":
    case "connecting":
      return { glow: 0.5, reach: 1.58, ring: 0.5, ticks: 0, glint: 0.55, spin: 0.12, rim: 0.45 };
    case "ended":
      return { glow: 0.26, reach: 1.45, ring: 0.28, ticks: 0, glint: 0, spin: 0, rim: 0.3 };
    case "error":
      return { glow: 0.2, reach: 1.42, ring: 0.22, ticks: 0, glint: 0, spin: 0, rim: 0.25 };
    case "idle":
    default:
      return { glow: 0.52, reach: 1.6, ring: 0.42, ticks: 0, glint: 0, spin: 0, rim: 0.48 };
  }
}

/** The still frame of a state (reduced motion): what a mid-sentence moment of it looks like. */
export function stillLook(status: VoiceStatus, muted: boolean): Look {
  return targetLook(status, status === "speaking" ? 0.5 : 0, muted);
}

/** Moves `value` towards `target` with time constant `tau` (seconds), frame-rate independent. */
export function ease(value: number, target: number, dt: number, tau: number): number {
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

export function easeLook(current: Look, target: Look, dt: number): Look {
  const tau = 0.35;
  return {
    glow: ease(current.glow, target.glow, dt, 0.12),
    reach: ease(current.reach, target.reach, dt, 0.14),
    ring: ease(current.ring, target.ring, dt, tau),
    ticks: ease(current.ticks, target.ticks, dt, tau),
    glint: ease(current.glint, target.glint, dt, tau),
    spin: ease(current.spin, target.spin, dt, 0.6),
    rim: ease(current.rim, target.rim, dt, 0.12),
  };
}

/** Below this, a difference no longer shows on screen (a fraction of one 8-bit colour step). */
const SETTLED_EPSILON = 0.002;

/** The look has reached its target and the level has died down: the next frame equals this one. */
export function lookSettled(current: Look, target: Look, level: number): boolean {
  if (Math.abs(level) > SETTLED_EPSILON) return false;
  return (Object.keys(target) as Array<keyof Look>).every((key) => Math.abs(current[key] - target[key]) <= SETTLED_EPSILON);
}

export type OrbCadence = "full" | "slow" | "stop" | "still";

/** Frame interval of the "slow" cadence: about 15 frames a second. */
export const SLOW_FRAME_MS = 66;

export function orbCadence(status: VoiceStatus, settled: boolean, reducedMotion: boolean): OrbCadence {
  if (reducedMotion) return "still";
  if (!settled) return "full";
  if (status === "ended" || status === "error") return "stop";
  if (status === "idle") return "slow";
  return "full";
}
