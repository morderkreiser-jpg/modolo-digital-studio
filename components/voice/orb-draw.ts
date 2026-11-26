// One frame of the voice orb (voice-orb.tsx), drawn on a canvas 2D context. Plain module, no React:
// the frame loop and the sizing stay in the component, and the node:test runner can load this.
import type { Look } from "./orb-motion";

// Site colours as RGB triplets: cream light (--film-cream), bright gold (--film-gold), gold.
const CREAM = "246, 241, 231";
const GOLD_HI = "232, 200, 119";
const GOLD = "201, 153, 47";

const TICKS = 96;
const MAJOR_EVERY = 8;
/**
 * Below this size (device pixels) nothing is drawn. A canvas laid out at 0 px gets a 1×1 backing
 * store, and the rim's radius (a quarter of the size, less 0.6 device pixels) came out negative:
 * arc() threw an IndexSizeError inside the frame loop, which then stopped (browser check R3-B1).
 */
export const MIN_ORB_PX = 8;

export interface OrbFrame {
  look: Look;
  /** Smoothed loudness (listening ticks). */
  level: number;
  /** Seconds since the loop started (breathing, tick shapes). */
  time: number;
  /** Glint angle in radians. */
  angle: number;
  /** Idle breathing on (off for still frames). */
  breathe: boolean;
}

/** The part of a 2D context the orb uses (a test passes a recorder). */
export type OrbContext = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "createRadialGradient"
  | "createLinearGradient"
  | "beginPath"
  | "arc"
  | "fill"
  | "stroke"
  | "moveTo"
  | "lineTo"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
>;

/** Draws one frame. Never asks the context for a negative radius; a canvas too small stays empty. */
export function drawOrb(context: OrbContext, width: number, height: number, dpr: number, frame: OrbFrame): void {
  context.clearRect(0, 0, width, height);
  const size = Math.min(width, height);
  if (!(size >= MIN_ORB_PX * Math.max(1, dpr))) return;
  const cx = width / 2;
  const cy = height / 2;
  const radius = size * 0.25;
  const { look } = frame;
  const breath = frame.breathe ? Math.sin((2 * Math.PI * frame.time) / 6.4) : 0;
  const glow = Math.max(0, look.glow + 0.07 * breath);
  const reach = Math.max(1, look.reach + 0.04 * breath);

  // 1 · Corona: cream light around the disc, warming towards its edge.
  const corona = context.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius * reach);
  corona.addColorStop(0, `rgba(${CREAM}, ${0.42 * glow})`);
  corona.addColorStop(0.2, `rgba(246, 232, 205, ${0.2 * glow})`);
  corona.addColorStop(0.55, `rgba(${GOLD_HI}, ${0.05 * glow})`);
  corona.addColorStop(1, `rgba(${GOLD_HI}, 0)`);
  context.fillStyle = corona;
  context.beginPath();
  context.arc(cx, cy, radius * reach, 0, Math.PI * 2);
  context.fill();

  // 2 · The disc: espresso, lit faintly from the upper left.
  const disc = context.createRadialGradient(cx - radius * 0.32, cy - radius * 0.38, 0, cx, cy, radius * 1.05);
  disc.addColorStop(0, "#2d261e");
  disc.addColorStop(0.55, "#1b1611");
  disc.addColorStop(1, "#100d09");
  context.fillStyle = disc;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();

  // 3 · Rim light: brighter at the top, where the corona is read first.
  const rim = context.createLinearGradient(cx, cy - radius, cx, cy + radius);
  rim.addColorStop(0, `rgba(${CREAM}, ${0.18 + 0.5 * look.rim})`);
  rim.addColorStop(0.5, `rgba(${CREAM}, ${0.06 + 0.12 * look.rim})`);
  rim.addColorStop(1, `rgba(${CREAM}, ${0.04 + 0.06 * look.rim})`);
  context.strokeStyle = rim;
  context.lineWidth = 1.25 * dpr;
  context.beginPath();
  context.arc(cx, cy, Math.max(0, radius - 0.6 * dpr), 0, Math.PI * 2);
  context.stroke();

  // 4 · The gold ring: a hairline, never a fill.
  const ringRadius = radius * 1.3;
  context.strokeStyle = `rgba(${GOLD}, ${0.75 * look.ring})`;
  context.lineWidth = 1 * dpr;
  context.beginPath();
  context.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  context.stroke();

  // 5 · The dial: hairline ticks outside the ring; while listening they follow the voice.
  const tickStart = ringRadius + 5 * dpr;
  const maxReach = Math.min(16 * dpr, radius * 0.24);
  context.lineCap = "round";
  for (let index = 0; index < TICKS; index += 1) {
    const theta = (index / TICKS) * Math.PI * 2 - Math.PI / 2;
    const major = index % MAJOR_EVERY === 0;
    const shape =
      0.5 + 0.28 * Math.sin(3 * theta + 1.7 * frame.time) + 0.22 * Math.sin(7 * theta - 2.3 * frame.time + 0.6);
    const response = look.ticks * frame.level * maxReach * (0.35 + 0.65 * shape);
    const length = (major ? 5 : 2.5) * dpr + response;
    const alpha = (major ? 0.32 : 0.16) + 0.5 * look.ticks * frame.level * shape;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    context.strokeStyle = `rgba(${CREAM}, ${Math.min(0.85, alpha)})`;
    context.lineWidth = (major ? 1 : 0.8) * dpr;
    context.beginPath();
    context.moveTo(cx + cos * tickStart, cy + sin * tickStart);
    context.lineTo(cx + cos * (tickStart + length), cy + sin * (tickStart + length));
    context.stroke();
  }

  // 6 · The glint: a short comet of light travelling the gold ring (thinking, connecting).
  if (look.glint > 0.01) {
    const segments = 18;
    const span = 0.95; // radians
    for (let index = 0; index < segments; index += 1) {
      const from = frame.angle - (span * (index + 1)) / segments;
      const to = frame.angle - (span * index) / segments;
      const fade = 1 - index / segments;
      context.strokeStyle = `rgba(${GOLD_HI}, ${0.85 * look.glint * fade * fade})`;
      context.lineWidth = (1.6 - 0.8 * (index / segments)) * dpr;
      context.beginPath();
      context.arc(cx, cy, ringRadius, from, to);
      context.stroke();
    }
    context.fillStyle = `rgba(${CREAM}, ${0.9 * look.glint})`;
    context.beginPath();
    context.arc(cx + Math.cos(frame.angle) * ringRadius, cy + Math.sin(frame.angle) * ringRadius, 1.7 * dpr, 0, Math.PI * 2);
    context.fill();
  }
}
