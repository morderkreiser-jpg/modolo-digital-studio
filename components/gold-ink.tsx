"use client";

import { useEffect, useRef, useState } from "react";
import { Renderer, Program, Mesh, Triangle, RenderTarget } from "ogl";

/**
 * THE GOLD-INK FLOWMAP — the "Inchiostro" signature.
 * A full-bleed OGL field that lives BEHIND the hero H1 (which stays the LCP element).
 * A ping-pong buffer accumulates pointer velocity into a decaying trail; that trail
 * blooms warm gold across the ivory paper and disperses back with inertia. Deferred
 * (mounts after fonts + idle), capability-gated, DPR-capped, paused when offscreen or
 * the tab is hidden. On coarse pointers / reduced-motion / reduced-data / no-WebGL it
 * never mounts — the ivory Paper simply shows through. Brand rule honoured: gold pools
 * as line/leaf, never a flat fill.
 */

const VERT = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

// Accumulation pass: decay the previous trail, splat a soft blob at the pointer scaled by speed.
const UPDATE = `
precision highp float;
uniform sampler2D tPrev;
uniform vec2 uMouse;
uniform float uSpeed;
uniform float uAspect;
uniform float uDecay;
uniform float uActive;
varying vec2 vUv;
void main() {
  float prev = texture2D(tPrev, vUv).r * uDecay;
  vec2 d = vUv - uMouse;
  d.x *= uAspect;
  float dist = length(d);
  // purely movement-driven: no constant base, so an idle cursor leaves no growing blob —
  // the trail simply blooms where the pointer travels and then decays back to clean paper.
  float splat = smoothstep(0.18, 0.0, dist) * uSpeed * 1.15 * uActive;
  float v = max(prev, min(prev + splat, 1.0));
  gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
}
`;

// Display pass: domain-warp the field a touch (ink bleed) and pool Paper -> gold along the trail.
const DISPLAY = `
precision highp float;
uniform sampler2D tMap;
uniform vec3 uPaper;
uniform vec3 uGold;
uniform vec3 uGilt;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float n = noise(vUv * vec2(uAspect, 1.0) * 4.0 + uTime * 0.03);
  vec2 uv = vUv + (n - 0.5) * 0.018;
  float m = texture2D(tMap, uv).r;
  m = smoothstep(0.04, 0.85, m);
  // brand gold (flyer #B5893F) that deepens toward the rich gold-ink in the dense core
  vec3 gold = mix(uGold, uGilt, smoothstep(0.55, 1.0, m) * 0.55);
  vec3 col = mix(uPaper, gold, m * 0.92);
  gl_FragColor = vec4(col, m);
}
`;

function toRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function GoldInk() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Capability + preference gates — bail (leave paper) if not a good fit.
    const mq = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;
    if (mq("(prefers-reduced-motion: reduce)") || mq("(prefers-reduced-data: reduce)") || !mq("(pointer: fine)")) return;
    if ((navigator.hardwareConcurrency || 4) < 4) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, dpr: Math.min(1.5, window.devicePixelRatio || 1) });
    } catch {
      return;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const geometry = new Triangle(gl);
    const opts = { width: 1, height: 1, type: gl.UNSIGNED_BYTE } as const;
    let fboA = new RenderTarget(gl, opts);
    let fboB = new RenderTarget(gl, opts);

    const paper = toRGB("#FBF8F2");
    const gold = toRGB("#B5893F"); // brand / flyer Leaf Gold
    const gilt = toRGB("#7E5D24"); // brand Deep Gold — richens the dense core

    const update = new Program(gl, {
      vertex: VERT, fragment: UPDATE,
      uniforms: {
        tPrev: { value: fboA.texture },
        uMouse: { value: [0.5, 0.5] },
        uSpeed: { value: 0 },
        uAspect: { value: 1 },
        uDecay: { value: 0.955 },
        uActive: { value: 0 },
      },
    });
    const display = new Program(gl, {
      vertex: VERT, fragment: DISPLAY,
      uniforms: {
        tMap: { value: fboA.texture },
        uPaper: { value: paper },
        uGold: { value: gold },
        uGilt: { value: gilt },
        uTime: { value: 0 },
        uAspect: { value: 1 },
      },
    });
    const mesh = new Mesh(gl, { geometry, program: update });

    const mouse = [0.5, 0.5];
    const target = [0.5, 0.5];
    let speed = 0;
    let engaged = false; // stays false (→ clean paper) until the pointer actually moves

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (!engaged) { engaged = true; mouse[0] = target[0] = x; mouse[1] = target[1] = y; } // snap, no center streak
      const dx = x - target[0], dy = y - target[1];
      speed = Math.min(1, Math.hypot(dx, dy) * 20);
      target[0] = x; target[1] = y;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      const dpr = renderer.dpr;
      const rw = Math.max(2, Math.round(w * dpr * 0.5));
      const rh = Math.max(2, Math.round(h * dpr * 0.5));
      fboA = new RenderTarget(gl, { ...opts, width: rw, height: rh });
      fboB = new RenderTarget(gl, { ...opts, width: rw, height: rh });
      update.uniforms.uAspect.value = w / h;
      display.uniforms.uAspect.value = w / h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let running = true;
    let t0 = performance.now();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!running) return;
      mouse[0] += (target[0] - mouse[0]) * 0.2;
      mouse[1] += (target[1] - mouse[1]) * 0.2;
      speed *= 0.9;

      update.uniforms.uMouse.value = mouse;
      update.uniforms.uSpeed.value = speed;
      update.uniforms.uActive.value = engaged ? 1 : 0;
      update.uniforms.tPrev.value = fboA.texture;
      mesh.program = update;
      renderer.render({ scene: mesh, target: fboB });

      const tmp = fboA; fboA = fboB; fboB = tmp;

      display.uniforms.tMap.value = fboA.texture;
      display.uniforms.uTime.value = (t - t0) / 1000;
      mesh.program = display;
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(loop);
    // fade the canvas in once it's producing frames
    const fadeTimer = window.setTimeout(() => setVisible(true), 60);

    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(host);
    const onVis = () => { running = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fadeTimer);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      io.disconnect();
      canvas.remove();
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 transition-opacity duration-[1200ms] ease-out"
      style={{ opacity: visible ? 1 : 0 }}
    />
  );
}
