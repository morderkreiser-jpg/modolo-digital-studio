"use client";

// The orb of the voice widget: a dark disc with a cream corona on the espresso field, a fine gold
// ring around it and a dial of hairline ticks outside the ring (the site's "measure" mark).
//   idle      the corona breathes, slowly
//   connecting / requesting the microphone: a dim glint travels the ring
//   listening the ticks reach out with the caller's loudness
//   thinking  a brighter glint turns along the ring
//   speaking  the corona swells and settles with the speech
//   ended / error: everything dims and holds still
// Canvas 2D, device-pixel-ratio aware, no WebGL and no library; one frame is drawn by orb-draw.ts.
// Loaded lazily by the stage (it is the animation loop); the stage paints a still CSS orb until it
// arrives.
//
// The loop only runs while the canvas is on screen and the tab is visible, and only as fast as
// the state needs (orb-motion.ts): full rate in a conversation, a few frames a second for the idle
// breathing, not at all once an ended or failed orb has dimmed. With prefers-reduced-motion
// nothing moves: one still frame per state, redrawn on state changes. The canvas size is read
// from the ResizeObserver, never in the frame loop (that would force a layout every frame while
// captions stream in). The canvas is decorative (aria-hidden): the stage announces the state in text.
import { useLayoutEffect, useRef } from "react";
import { drawOrb, type OrbFrame } from "./orb-draw";
import { ease, easeLook, lookSettled, orbCadence, SLOW_FRAME_MS, stillLook, targetLook } from "./orb-motion";
import type { VoiceStatus } from "./voice-machine";

export interface VoiceOrbProps {
  status: VoiceStatus;
  /** Loudness 0..1, polled once per frame (the transport's getLevel). */
  getLevel: () => number;
  muted?: boolean;
  className?: string;
}

/** Higher pixel densities cost fill rate and add nothing visible to soft gradients. */
const MAX_DPR = 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

    /**
     * One frame. The orb is decoration: a drawing error must neither stop the frame loop nor reach
     * the console (drawOrb already skips a canvas too small to draw on, browser check R3-B1).
     */
    const paint = (frame: OrbFrame) => {
      try {
        drawOrb(context, width, height, dpr, frame);
      } catch {
        context.clearRect(0, 0, width, height);
      }
    };

    const drawStill = () => {
      resize();
      paint({
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
      paint({
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
