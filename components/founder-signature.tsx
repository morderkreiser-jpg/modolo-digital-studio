"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Francesco's handwritten signature — the section's memorable object. It signs itself once
 * when scrolled into view: a panel-coloured cover retracts to the right (scaleX 1→0), so the
 * ink is revealed left-to-right like a pen writing. Under prefers-reduced-motion it is simply
 * present, fully drawn.
 *
 * The reveal uses a retracting cover (transform/scaleX) rather than an animated clip-path,
 * because this Framer build does not interpolate clip-path via whileInView — the cover is a
 * plain transform, which always animates. The asset is a self-hosted transparent WebP loaded
 * eagerly (27 KB, no CDN, no runtime font) so the reveal always has something to uncover.
 */
export default function FounderSignature({ label }: { label: string }) {
  const reduce = useReducedMotion();

  return (
    <div className="relative inline-block w-[clamp(190px,26vw,300px)] select-none">
      <Image
        src="/signature-francesco.webp"
        alt={label}
        width={1206}
        height={213}
        unoptimized
        loading="eager"
        className="block h-auto w-full"
        role="img"
        draggable={false}
      />
      <motion.span
        aria-hidden
        className="absolute inset-0"
        style={{ background: "var(--ink-panel)", transformOrigin: "right center" }}
        initial={{ scaleX: reduce ? 0 : 1 }}
        whileInView={{ scaleX: 0 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={reduce ? { duration: 0 } : { duration: 1.05, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}
