"use client";

// The orb of the voice widget: a dark disc with a cream corona on the espresso field, a fine gold
// ring around it and a dial of hairline ticks outside the ring (the site's "measure" mark).
//   idle      the corona breathes, slowly
//   connecting / requesting the microphone: a dim glint travels the ring
//   listening the ticks reach out with the caller's loudness
//   thinking  a brighter glint turns along the ring
//   speaking  the corona swells and settles with the speech
//   ended / error: everything dims and holds still
// Canvas 2D, device-pixel-ratio aware, no WebGL and no library. Loaded lazily by the stage (it
// is the animation loop); the stage paints a still CSS orb until it arrives.
//
// The loop only runs while the canvas is on screen and the tab is visible, and only as fast as
// the state needs (orb-motion.ts): full rate in a conversation, a few frames a second for the idle
// breathing, not at all once an ended or failed orb has dimmed. With prefers-reduced-motion
// nothing moves: one still frame per state, redrawn on state changes. The canvas size is read
// from the ResizeObserver, never in the frame loop (that would force a layout every frame while
// captions stream in). The canvas is decorative (aria-hidden): the stage announces the state in text.
import { useLayoutEffect, useRef } from "react";
import { ease, easeLook, lookSettled, orbCadence, SLOW_FRAME_MS, stillLook, targetLook, type Look } from "./orb-motion";
import type { VoiceStatus } from "./voice-machine";

export interface VoiceOrbProps {
  status: VoiceStatus;
  /** Loudness 0..1, polled once per frame (the transport's getLevel). */
  getLevel: () => number;
  muted?: boolean;
  className?: string;
}

// Site colours as RGB triplets: cream light (--film-cream), bright gold (--film-gold), gold.
const CREAM = "246, 241, 231";
const GOLD_HI = "232, 200, 119";
const GOLD = "201, 153, 47";

const TICKS = 96;
const MAJOR_EVERY = 8;
/** Higher pixel densities cost fill rate and add nothing visible to soft gradients. */
const MAX_DPR = 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface Frame {
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

function drawOrb(context: CanvasRenderingContext2D, width: number, height: number, dpr: number, frame: Frame): void {
  context.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  const radius = size * 0.25;
  const { look } = frame;
  const breath = frame.breathe ? Math.sin((2 * Math.PI * frame.time) / 6.4) : 0;
  const glow = Math.max(0, look.glow + 0.07 * breath);
  const reach = look.reach + 0.04 * breath;

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
  context.arc(cx, cy, radius - 0.6 * dpr, 0, Math.PI * 2);
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

export default function VoiceOrb({ status, getLevel, muted = false, className }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The loop reads these through refs, so a state change never restarts it.
  const statusRef = useRef(status);
  const mutedRef = useRef(muted);
  const getLevelRef = useRef(getLevel);
  /** Set by the loop: a state change redraws the still frame, or wakes a stopped or slow loop. */
  const changedRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    statusRef.current = status;
    mutedRef.current = muted;
    getLevelRef.current = getLevel;
    changedRef.current();
  }, [status, muted, getLevel]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true }) ?? null;
    if (!canvas || !context) return;

    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let reduced = motionQuery.matches;
    let onScreen = true;
    let pageVisible = document.visibilityState !== "hidden";
    let frameId = 0;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTime = 0;
    let clock = 0;
    let angle = -Math.PI / 2;
    let level = 0;
    let look = targetLook(statusRef.current, 0, mutedRef.current);
    let width = 0;
    let height = 0;
    let dpr = 1;
    /** CSS size of the canvas, from the ResizeObserver (or one measurement without it). */
    let cssWidth = 0;
    let cssHeight = 0;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width;
      cssHeight = rect.height;
    };

    /** Sizes the backing store to the CSS size; true when it changed (and was cleared). */
    const resize = (): boolean => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (nextWidth === width && nextHeight === height) return false;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      return true;
    };

    const drawStill = () => {
      resize();
      drawOrb(context, width, height, dpr, {
        look: stillLook(statusRef.current, mutedRef.current),
        level: 0.45,
        time: 0,
        // The glint of a still "thinking" frame sits at the upper right, where a clock reads 1.
        angle: -Math.PI / 3,
        breathe: false,
      });
    };

    const tick = (timestamp: number) => {
      frameId = 0;
      // A long gap (tab restored, loop resumed) must not make everything jump.
      const dt = lastTime === 0 ? 1 / 60 : Math.min(0.1, (timestamp - lastTime) / 1000);
      lastTime = timestamp;
      clock += dt;
      let raw = 0;
      try {
        raw = getLevelRef.current();
      } catch {
        raw = 0;
      }
      const status = statusRef.current;
      const target = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      // Fast attack, slower release: the dial jumps with a syllable and settles calmly.
      level = ease(level, target, dt, target > level ? 0.05 : 0.22);
      const goal = targetLook(status, level, mutedRef.current);
      look = easeLook(look, goal, dt);
      angle += look.spin * dt * Math.PI * 2;
      // Without a ResizeObserver the size has to be read here (a forced layout, the old way).
      if (resizeObserver === null) measure();
      resize();
      drawOrb(context, width, height, dpr, {
        look,
        level,
        time: clock,
        angle,
        breathe: status === "idle",
      });
      const cadence = orbCadence(status, lookSettled(look, goal, level), reduced);
      if (cadence === "slow") scheduleSlow();
      else if (cadence === "full") schedule();
      // "stop": the last frame stays on the canvas; a state change wakes the loop (changedRef).
    };

    const canRun = () => !reduced && onScreen && pageVisible;

    const schedule = () => {
      if (frameId === 0 && slowTimer === undefined && canRun()) frameId = requestAnimationFrame(tick);
    };

    const scheduleSlow = () => {
      if (frameId !== 0 || slowTimer !== undefined || !canRun()) return;
      slowTimer = setTimeout(() => {
        slowTimer = undefined;
        schedule();
      }, SLOW_FRAME_MS);
    };

    const pause = () => {
      if (frameId !== 0) cancelAnimationFrame(frameId);
      frameId = 0;
      clearTimeout(slowTimer);
      slowTimer = undefined;
      lastTime = 0;
    };

    const update = () => {
      if (reduced) {
        pause();
        drawStill();
      } else if (onScreen && pageVisible) {
        schedule();
      } else {
        pause();
      }
    };

    changedRef.current = () => {
      if (reduced) {
        // A new state is a new still frame.
        drawStill();
        return;
      }
      // A stopped or slowed loop runs at full rate again until the new look has settled.
      if (slowTimer !== undefined) {
        clearTimeout(slowTimer);
        slowTimer = undefined;
      }
      schedule();
    };

    const onMotionChange = () => {
      reduced = motionQuery.matches;
      update();
    };
    const onVisibility = () => {
      pageVisible = document.visibilityState !== "hidden";
      update();
    };
    motionQuery.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibility);

    let intersection: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver((entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        update();
      });
      intersection.observe(canvas);
    }
    // A resized canvas is cleared: redraw it at once, also when the loop is stopped or slow.
    const redrawAfterResize = () => {
      if (!resize()) return;
      if (reduced) drawStill();
      else changedRef.current();
    };
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box) {
          cssWidth = box.width;
          cssHeight = box.height;
        } else {
          measure();
        }
        redrawAfterResize();
      });
      resizeObserver.observe(canvas);
    }
    // Zoom and moving the window to another screen change the pixel ratio, not the CSS size.
    const onWindowResize = () => redrawAfterResize();
    window.addEventListener("resize", onWindowResize);

    // First paint before the browser shows the canvas: no empty frame after the still CSS orb.
    measure();
    drawStill();
    update();

    return () => {
      pause();
      changedRef.current = () => undefined;
      motionQuery.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onWindowResize);
      intersection?.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" data-testid="voice-orb" />;
}
