"use client";

// Mobile sticky bar (SPEC §5.3, D13): cream, < 768 px only, homepage only. Appears once section 01
// has passed under the nav (same film sentinel as the nav), hides while #contatti fills ≥ 25 % of
// the screen, while a text field has focus, while the mobile menu is open and while a consent card
// says it is open. Plain links (no role), rendered after <main>.
//
// Contract for a future bottom consent card (another session's file, not imported here): position it
// at `bottom: calc(var(--mds-sticky-h, 0px) + 12px)` and dispatch `mds:consent-open` /
// `mds:consent-close` on window; the bar hides while it is open. `--mds-sticky-h` is set on <html>
// only while the bar is visible (64 px + safe area), otherwise 0px.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";
import { STICKY, STICKY_PRICES_HREF } from "@/content/home/sticky";
import { PREFILL } from "@/content/home/prefills";
import { waHref } from "@/lib/whatsapp";
import { useRegion } from "@/components/use-region";
import { useFilmZone, WhatsAppGlyph } from "@/components/site-nav";

const MOBILE_MQ = "(max-width: 767px)";
const BAR_H = "calc(64px + env(safe-area-inset-bottom, 0px))";

const REDUCE_MQ = "(prefers-reduced-motion: reduce)";

function subscribeMq(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  };
}
const subscribeMobile = subscribeMq(MOBILE_MQ);
const subscribeReduce = subscribeMq(REDUCE_MQ);
const isMobile = () => window.matchMedia(MOBILE_MQ).matches;
const prefersReduce = () => window.matchMedia(REDUCE_MQ).matches;
const serverFalse = () => false;

// Fields that open the on-screen keyboard (the bar would sit on top of it).
function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"].includes(el.type);
}

export default function StickyBar({ lang }: { lang: Locale }) {
  const t = STICKY[lang];
  const region = useRegion();
  const onFilm = useFilmZone(true);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, serverFalse);
  const reduce = useSyncExternalStore(subscribeReduce, prefersReduce, serverFalse);
  const [nearContact, setNearContact] = useState(false);
  const [typing, setTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const show = !onFilm && !nearContact && !typing && !menuOpen && !consentOpen;
  const active = show && mobile;

  // #contatti covers at least the bottom quarter of the screen → the form is the CTA now.
  useEffect(() => {
    const contact = document.getElementById("contatti");
    if (!contact) return;
    const io = new IntersectionObserver(([e]) => setNearContact(e.isIntersecting), {
      rootMargin: "0px 0px -25% 0px",
      threshold: 0,
    });
    io.observe(contact);
    return () => io.disconnect();
  }, []);

  // Text field focus, mobile menu, consent card.
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(isTextField(e.target));
    const onOut = (e: FocusEvent) => setTyping(isTextField(e.relatedTarget));
    const menuOn = () => setMenuOpen(true);
    const menuOff = () => setMenuOpen(false);
    const consentOn = () => setConsentOpen(true);
    const consentOff = () => setConsentOpen(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    window.addEventListener("mds:menu-open", menuOn);
    window.addEventListener("mds:menu-close", menuOff);
    window.addEventListener("mds:consent-open", consentOn);
    window.addEventListener("mds:consent-close", consentOff);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      window.removeEventListener("mds:menu-open", menuOn);
      window.removeEventListener("mds:menu-close", menuOff);
      window.removeEventListener("mds:consent-open", consentOn);
      window.removeEventListener("mds:consent-close", consentOff);
    };
  }, []);

  // While visible: publish the height, keep scroll-into-view clear of the bar, and never let a
  // keyboard-focused element sit underneath it (WCAG 2.4.11).
  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.style.setProperty("--mds-sticky-h", "0px");
      root.style.removeProperty("scroll-padding-bottom");
      return;
    }
    root.style.setProperty("--mds-sticky-h", BAR_H);
    root.style.setProperty("scroll-padding-bottom", `calc(${BAR_H} + 12px)`);
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      const bar = barRef.current;
      if (!(el instanceof HTMLElement) || !bar || bar.contains(el)) return;
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const barTop = bar.getBoundingClientRect().top;
        if (r.bottom > barTop - 8 && r.top < window.innerHeight) {
          window.scrollBy({ top: r.bottom - barTop + 16, behavior: "auto" });
        }
      });
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      root.style.setProperty("--mds-sticky-h", "0px");
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, [active]);

  return (
    <div
      ref={barRef}
      data-sticky-bar
      inert={!show}
      className={`fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-[#17130e]/12 bg-[#f6f1e7]/[0.97] shadow-[0_-8px_24px_rgb(23_19_14/0.08)] ${
        show ? "visible translate-y-0" : "invisible translate-y-[calc(100%+40px)]"
      }`}
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        // Tailwind 4 translate-* utilities set the `translate` property, not `transform`.
        // Reduced motion: appears and disappears instantly.
        transition: reduce
          ? "none"
          : show
            ? "translate 200ms cubic-bezier(0.16,1,0.3,1), visibility 0s"
            : "translate 200ms cubic-bezier(0.16,1,0.3,1), visibility 0s linear 200ms",
      }}
    >
      <div className="flex h-16 items-center gap-3 px-3">
        <a
          href={waHref(PREFILL[lang].sticky, region)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t.whatsapp}${t.whatsappSrOnly}`}
          className="flex h-12 min-w-0 flex-[64_1_0%] items-center justify-center gap-2 rounded-full bg-[linear-gradient(100deg,#e8c877,#b5893f)] px-4 text-base font-semibold text-[#17130e] shadow-[0_6px_16px_-8px_rgb(126_93_36/0.7)]"
        >
          <WhatsAppGlyph className="h-5 w-5 shrink-0" />
          {/* Accessible name "WhatsApp-Nachricht schreiben" (COPY §17) as an aria-label that starts with
              the visible word: an sr-only span would make Chrome read "WhatsApp -Nachricht". */}
          <span>{t.whatsapp}</span>
        </a>
        <a
          href={STICKY_PRICES_HREF}
          className="flex h-12 min-w-0 flex-[36_1_0%] items-center justify-center rounded-full border border-[#17130e]/25 px-3 text-base font-medium text-[#17130e]"
        >
          {t.prices}
        </a>
      </div>
    </div>
  );
}
