"use client";

import { useEffect, useRef, useState } from "react";
import {
  useIsClient,
  useMediaQuery,
  usePageVisible,
  usePrefersReducedMotion,
  useSaveData,
  useSlowConnection,
} from "@/lib/browser-state";
import { FILM, LANDSCAPE_1080_MQ, PORTRAIT_MQ, filmShotAt, type FilmLocale } from "@/lib/film-media";
import { filmStore, onPlayRejected, useFilmState } from "./film-store";

type Props = {
  lang: FilmLocale;
  /** Classes for the <video> (absolute fill, object-fit, object-position = the poster's). */
  className?: string;
};

/**
 * The hero film (SPEC §2.9). The poster <picture> underneath is rendered by the server; this island
 * adds the <video> only when it makes sense:
 * - never during SSR or hydration (reduced motion is the server value, see lib/browser-state.ts),
 * - not with prefers-reduced-motion, Save-Data, a slow-2g/2g/3g connection, or a remembered pause
 *   (then the toggle offers «Film abspielen» and a click is an explicit opt-in),
 * - otherwise after window `load` + 400 ms, while the hero is on screen and the tab is visible.
 * AV1 first, H.264 second; 9:16 under PORTRAIT_MQ, 16:9 1080 from 1280 px, else 16:9 720.
 * An AV1 file the browser picks but then cannot decode does not move on to the next <source>, so the
 * <video> switches once to the H.264 file of the same rendition (see onError).
 * It pauses off-screen and in hidden tabs, and only the VIDEO fades in, on its first `playing`.
 * If play() is refused (iOS Low Power Mode) or no file plays, the poster simply stays.
 * Every presented frame reports its shot to the film store, so the live credit under the H1 names the
 * website that is on screen right now (requestVideoFrameCallback; `timeupdate` where it is missing).
 */
export default function BackgroundFilm({ lang, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wantPlayRef = useRef(false);
  const seekedRef = useRef(false);

  const isClient = useIsClient();
  const reduce = usePrefersReducedMotion();
  const saveData = useSaveData();
  const slow = useSlowConnection();
  const pageVisible = usePageVisible();
  const portrait = useMediaQuery(PORTRAIT_MQ);
  const large = useMediaQuery(LANDSCAPE_1080_MQ);
  const { status, intent } = useFilmState();

  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const [shownKey, setShownKey] = useState<string | null>(null);

  const setKey = portrait ? "9x16-720" : large ? "16x9-1080" : "16x9-720";
  const sources = FILM.sources[setKey];

  const blocked = reduce || saveData || slow || intent === "pause";
  const wanted = intent === "play" || (intent === "auto" && !blocked);
  const shouldPlay = isClient && wanted && inView && pageVisible && status !== "refused";
  // Mount on an explicit «play», or automatically once the page is loaded and the hero is seen.
  // Once mounted (status left "idle") the element stays, so a pause keeps the last frame.
  const mount =
    isClient && (intent === "play" || status !== "idle" || (!blocked && loaded && inView && pageVisible));
  const visible = shownKey === setKey && status !== "refused";

  // Text and poster first, the film after: wait for window load + 400 ms.
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => setLoaded(true), 400);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
    };
  }, []);

  // Hero on screen? (threshold .1, SPEC §2.9)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Register the element with the store (the toggle calls play()/pause() on it inside its click).
  useEffect(() => {
    const el = videoRef.current;
    if (!mount || !el) return;
    seekedRef.current = false;
    filmStore.attach(el);
    return () => filmStore.detach(el);
  }, [mount, setKey]);

  // The live credit follows the frame on screen (SPEC §2.5). rVFC fires only for frames the browser
  // actually presents, so a paused, off-screen or hidden-tab film keeps the shot of its last frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!mount || !v) return;
    const report = (t: number) => filmStore.setShot(filmShotAt(t));
    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      let id = 0;
      let live = true;
      const tick: VideoFrameRequestCallback = (_now, meta) => {
        if (!live) return;
        report(meta.mediaTime);
        id = v.requestVideoFrameCallback(tick);
      };
      // (Re)armed on every loaded file too: after the H.264 fallback's load() the loop keeps exactly one
      // callback even in an engine that drops pending callbacks with the old file.
      const arm = () => {
        v.cancelVideoFrameCallback(id);
        id = v.requestVideoFrameCallback(tick);
      };
      arm();
      v.addEventListener("loadeddata", arm);
      return () => {
        live = false;
        v.removeEventListener("loadeddata", arm);
        v.cancelVideoFrameCallback(id);
      };
    }
    // Fallback (no rVFC): `timeupdate` fires about 4 times a second, so the credit is at most ≈250 ms late.
    const on = () => report(v.currentTime);
    v.addEventListener("timeupdate", on);
    v.addEventListener("seeked", on);
    return () => {
      v.removeEventListener("timeupdate", on);
      v.removeEventListener("seeked", on);
    };
  }, [mount, setKey]);

  // Play while wanted and on screen, pause otherwise.
  useEffect(() => {
    wantPlayRef.current = shouldPlay;
    const el = videoRef.current;
    if (!el) return;
    if (shouldPlay) {
      if (el.paused) el.play().catch(onPlayRejected);
    } else if (!el.paused) {
      el.pause();
    }
  }, [shouldPlay, mount, setKey]);

  return (
    <div ref={wrapRef} aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
      {mount ? (
        <video
          key={setKey}
          ref={videoRef}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
          data-film-video={setKey}
          className={className}
          style={{ opacity: visible ? 1 : 0, transition: "opacity 400ms ease-out" }}
          onLoadedMetadata={(e) => {
            // A locale may start later in the loop (FILM.startAt); its poster is that frame, so the cut is seamless.
            const v = e.currentTarget;
            const start = FILM.startAt[lang];
            if (!seekedRef.current && start > 0 && v.currentTime < start) v.currentTime = start;
            seekedRef.current = true;
          }}
          onPlaying={(e) => {
            // autoPlay can start a film we no longer want (scrolled away, paused meanwhile).
            if (!wantPlayRef.current && filmStore.get().intent !== "play") {
              e.currentTarget.pause();
              return;
            }
            setShownKey(setKey);
            filmStore.setStatus("playing");
          }}
          onPause={() => {
            const s = filmStore.get();
            if (s.status === "refused") return;
            filmStore.setStatus(s.intent === "pause" ? "paused-user" : s.status === "playing" ? "paused-auto" : s.status);
          }}
          onError={(e) => {
            // React hands a <source>'s `error` to this handler too (its events bubble through the component
            // tree, the native one does not). The AV1 <source> errors on every browser without AV1 (most
            // iPhones: unsupported type) and when its request fails; the browser then moves on to H.264.
            // So only the <video>'s own error counts here; the last <source> reports below.
            if (e.target !== e.currentTarget) return;
            const v = e.currentTarget;
            const code = v.error?.code;
            // The <video>'s own error comes after a file was chosen, and the browser never tries the next
            // <source> then. An AV1 file that cannot be decoded (a WebKit build that claims AV1, a damaged
            // file) gets one more chance: this rendition's H.264 file, set as src. The status stays as it is
            // (no «refused» flash): the video fades out over the poster, the credit names the poster's shot,
            // and the first `playing` of the H.264 file fades it back in. If H.264 fails too, its error
            // lands here with currentSrc = H.264, and the film is refused.
            if (
              (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) &&
              v.currentSrc.endsWith(sources[0].src)
            ) {
              seekedRef.current = false; // the H.264 file starts where the poster is, like a fresh film
              setShownKey(null);
              filmStore.setShot(filmShotAt(FILM.startAt[lang]));
              v.src = sources[1].src;
              v.load();
              // load() pauses and re-arms autoplay: play only if the film is still wanted.
              if (wantPlayRef.current) v.play().catch(onPlayRejected);
              else v.pause();
              return;
            }
            filmStore.setStatus("refused");
          }}
        >
          <source src={sources[0].src} type={sources[0].type} />
          {/* The last <source> failing means no file could be played. */}
          <source src={sources[1].src} type={sources[1].type} onError={() => filmStore.setStatus("refused")} />
        </video>
      ) : null}
    </div>
  );
}
