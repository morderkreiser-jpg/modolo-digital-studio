// Lenis momentum scroll on GSAP's ticker, for the inner pages. Loaded on demand by
// components/smooth-scroll.tsx, so the pages that scroll natively (the homepage with the hero film,
// SPEC §5.7 / D22, and the business card) never download Lenis or GSAP.
//
// Same behaviour as the earlier <ReactLenis root>: one Lenis instance on the document, advanced off
// the single GSAP ticker (autoRaf: false), ScrollTrigger kept in sync, anchors offset by the nav.
// Under prefers-reduced-motion the wheel stays native (lerp 1, no smoothing).
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function startLenis(reduce: boolean): () => void {
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({
    autoRaf: false,
    duration: 1.05,
    lerp: reduce ? 1 : 0.11,
    smoothWheel: !reduce,
    wheelMultiplier: 1,
    anchors: { offset: -80 },
  });
  const onScroll = () => ScrollTrigger.update();
  lenis.on("scroll", onScroll);
  const update = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(update);
  gsap.ticker.lagSmoothing(0);

  // Handle for tooling and captures (.redesign scripts drive scrolling through it).
  const w = window as unknown as { __lenis?: unknown };
  w.__lenis = lenis;

  return () => {
    gsap.ticker.remove(update);
    lenis.off("scroll", onScroll);
    lenis.destroy();
    if (w.__lenis === lenis) delete w.__lenis;
  };
}
