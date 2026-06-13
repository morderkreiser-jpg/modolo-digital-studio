"use client";

import { MotionConfig } from "framer-motion";

// Make framer-motion globally honor the user's "reduce motion" OS/browser setting:
// for those users it drops transform/layout animations (e.g. the whileInView slide-ups)
// and keeps only opacity — CSS-level reduced-motion is already handled in globals.css.
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
