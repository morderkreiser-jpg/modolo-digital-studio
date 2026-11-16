"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Chi siamo's entrance (SPEC D27): the old framer rise (30 px, 0.8 s, once, when the block is 10 %
 * inside the viewport) as CSS, see [data-rise] in app/globals.css. The server HTML shows the content.
 * After hydration a block that still sits below the fold is armed (opacity 0, 30 px lower, no
 * transition) and released when it scrolls in. A block already on screen, a visitor who prefers
 * reduced motion, or a browser without JavaScript: nothing happens, so nothing can stay hidden.
 * (The framer version rendered opacity:0 into the server HTML and broke hydration under reduced motion.)
 */
export default function Rise({
  className,
  delay = 0,
  children,
}: {
  className?: string;
  /** Seconds, like framer's transition.delay. */
  delay?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.dataset.rise = "armed";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.rise = "in";
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={delay ? { transitionDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}
