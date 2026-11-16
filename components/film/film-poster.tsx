import { PORTRAIT_MQ, filmPoster, type FilmLocale } from "@/lib/film-media";

type Props = {
  lang: FilmLocale;
  /** Classes for the <img> (absolute fill, object-fit cover, object-position = the video's). */
  className?: string;
};

/**
 * The film's first frame as a server-rendered <picture>: 9:16 under PORTRAIT_MQ, 16:9 otherwise,
 * AVIF → WebP → JPG. Each locale gets the frame its film starts on (FILM.posterStart): today all three
 * open on frame 0, BJ Studio's live homepage on a laptop (16:9) or a phone (9:16), the shot the credit
 * under the H1 names before any video loads.
 * In the HTML from the first byte, high fetch priority, no fade: the visitor sees it, but it
 * covers the viewport, so Chromium leaves it out of LCP (the h1 / sub are the LCP).
 */
export default function FilmPoster({ lang, className = "" }: Props) {
  const land = filmPoster(lang, "16x9");
  const port = filmPoster(lang, "9x16");

  return (
    <picture>
      <source media={PORTRAIT_MQ} type={port.avif.type} srcSet={port.avif.src} width={port.width} height={port.height} />
      <source media={PORTRAIT_MQ} type={port.webp.type} srcSet={port.webp.src} width={port.width} height={port.height} />
      <source media={PORTRAIT_MQ} type={port.jpg.type} srcSet={port.jpg.src} width={port.width} height={port.height} />
      <source type={land.avif.type} srcSet={land.avif.src} />
      <source type={land.webp.type} srcSet={land.webp.src} />
      {/* Plain <img> on purpose: pre-encoded AVIF/WebP/JPG with a portrait media query; next/image would re-encode it. */}
      <img
        src={land.jpg.src}
        alt=""
        width={land.width}
        height={land.height}
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className={className}
      />
    </picture>
  );
}
