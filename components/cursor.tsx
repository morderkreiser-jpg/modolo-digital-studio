"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";

/**
 * Custom cursor — a gold hairline ring that trails the pointer with spring lag and
 * grows on interactive elements; over portfolio media it fills and shows a "Vedi →"
 * label (element supplies data-cursor="view" + data-cursor-label). Additive over the
 * native cursor everywhere except items that opt into `cursor:none`. Fine pointers only,
 * never under reduced-motion or touch — degrades to the native cursor with zero cost.
 */
export default function Cursor() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [variant, setVariant] = useState<"default" | "link" | "view">("default");
  const [label, setLabel] = useState("");

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 450, damping: 38, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 450, damping: 38, mass: 0.4 });

  useEffect(() => {
    if (reduce) return;
    if (typeof matchMedia === "undefined" || !matchMedia("(pointer: fine)").matches) return;
    setEnabled(true);

    const move = (e: PointerEvent) => { x.set(e.clientX); y.set(e.clientY); };
    const over = (e: PointerEvent) => {
      const t = (e.target as HTMLElement) ?? null;
      const view = t?.closest?.("[data-cursor='view']") as HTMLElement | null;
      if (view) { setVariant("view"); setLabel(view.dataset.cursorLabel || "Vedi"); return; }
      if (t?.closest?.("a, button, [role='button'], input, textarea, select, label")) { setVariant("link"); return; }
      setVariant("default");
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
    };
  }, [reduce, x, y]);

  if (!enabled) return null;

  const size = variant === "view" ? 74 : variant === "link" ? 46 : 12;

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[70] hidden sm:flex items-center justify-center rounded-full"
      style={{ x: sx, y: sy, translateX: "-50%", translateY: "-50%" }}
    >
      <motion.div
        className="flex items-center justify-center rounded-full"
        animate={{
          width: size,
          height: size,
          backgroundColor: variant === "view" ? "rgba(181,137,63,0.92)" : "rgba(181,137,63,0)",
          borderColor: variant === "default" ? "rgba(181,137,63,1)" : "rgba(181,137,63,0.7)",
          borderWidth: variant === "view" ? 0 : variant === "default" ? 0 : 1,
        }}
        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.5 }}
        style={{ border: "1px solid var(--color-gold)" }}
      >
        {variant === "default" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-gold)" }} />}
        {variant === "view" && (
          <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--paper)" }}>
            {label} →
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}
