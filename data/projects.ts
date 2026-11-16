// Real work shown on the homepage (section 01 · Arbeiten). FACTS ONLY: every user-facing string
// lives in content/home/work.ts, keyed by the project id.
//
// Rules (SPEC §4.1, D17, D29):
// - A project renders only when `public && live`. Flip one flag and it leaves (or returns to)
//   every page; nothing else needs to change.
// - `kind: "own"` = Francesco's own product. It is never counted as a client and never labelled
//   «Kunde/Kundin».
// - While `approval` is set, the project still renders, but with a visible «Nur Vorschau» badge in
//   EVERY environment, so it can never go live looking final by accident. Remove the field once
//   the client has said yes in writing; set `public: false` if the answer is no.
// - `checked` = the day the live URL was last opened and answered 200.
// - `shot` = the screenshot in public/img/work/, captured from the live site with Playwright
//   (C:\Users\franc\progetti\modolo-media-src\work-shots\capture-work.mjs + encode-work.cjs).
//   File names carry a content hash (immutable caching). `captured` is the capture day: when it
//   changes, update the month in content/home/work.ts (`phoneCaption`) too.

export type ProjectId = "bjstudio" | "zumove" | "zurikey" | "saporivivi";

export type ProjectShot = {
  /** "phone" = portrait capture shown in the phone frame; "desktop" = 16:10 thumbnail. */
  frame: "phone" | "desktop";
  /** Intrinsic size of the smallest file (used for width/height, so nothing shifts on load). */
  width: number;
  height: number;
  /** Smallest width first. Paths are relative to /public. */
  avif: readonly { src: string; w: number }[];
  webp: readonly { src: string; w: number }[];
  jpg: string;
  captured: string;
};

export type Project = {
  id: ProjectId;
  /** Proper name as the business writes it; not translated. */
  name: string;
  kind: "client" | "own";
  url: string;
  /** What the visitor reads next to the live dot. */
  host: string;
  live: boolean;
  public: boolean;
  approval?: "NEEDS_MARCO_OK";
  checked: string;
  shot?: ProjectShot;
};

export const PROJECTS: readonly Project[] = [
  {
    id: "bjstudio",
    name: "BJ Studio de Belleza",
    kind: "client",
    url: "https://bjstudiodebelleza.ch",
    host: "bjstudiodebelleza.ch",
    live: true,
    public: true,
    checked: "2026-11-15",
    // 393×823 @3x, German, top of the page only. D18: the clip ends 20 px above BJ's own
    // «★★★★★ Zufriedene Kundinnen» row, so her rating can never read as his.
    shot: {
      frame: "phone",
      width: 540,
      height: 1131,
      avif: [
        { src: "/img/work/bjstudio-de-540-0860b152.avif", w: 540 },
        { src: "/img/work/bjstudio-de-810-6748b585.avif", w: 810 },
      ],
      webp: [
        { src: "/img/work/bjstudio-de-540-f2127eb2.webp", w: 540 },
        { src: "/img/work/bjstudio-de-810-8ab3ae90.webp", w: 810 },
      ],
      jpg: "/img/work/bjstudio-de-540-7d5bb0f1.jpg",
      captured: "2026-11-15",
    },
  },
  {
    id: "zumove",
    name: "ZUMOVE",
    kind: "client",
    url: "https://zumove.ch",
    host: "zumove.ch",
    live: true,
    // Hidden until the owner agrees in writing (16.11.2026). With his OK: public: true and
    // remove `approval`, in the same commit.
    public: false,
    approval: "NEEDS_MARCO_OK",
    checked: "2026-11-15",
    // zumove.ch/de, 1280×800 @2x, film paused at 6.4 s, cropped to 16:10 above the services bar.
    shot: {
      frame: "desktop",
      width: 400,
      height: 250,
      avif: [
        { src: "/img/work/zumove-de-400-67e05fea.avif", w: 400 },
        { src: "/img/work/zumove-de-640-1afb88d4.avif", w: 640 },
      ],
      webp: [
        { src: "/img/work/zumove-de-400-9952a808.webp", w: 400 },
        { src: "/img/work/zumove-de-640-901c7b79.webp", w: 640 },
      ],
      jpg: "/img/work/zumove-de-400-5a859469.jpg",
      captured: "2026-11-15",
    },
  },
  {
    id: "zurikey",
    name: "ZüriKey",
    kind: "own",
    url: "https://zurikey.ch",
    host: "zurikey.ch",
    live: true,
    public: true,
    checked: "2026-11-15",
    // zurikey.ch/de, 1280×800 @2x, cropped to 16:10 (the floating WhatsApp bubble stays outside).
    shot: {
      frame: "desktop",
      width: 400,
      height: 250,
      avif: [
        { src: "/img/work/zurikey-de-400-0367420f.avif", w: 400 },
        { src: "/img/work/zurikey-de-640-d77d8829.avif", w: 640 },
      ],
      webp: [
        { src: "/img/work/zurikey-de-400-af7e0d08.webp", w: 400 },
        { src: "/img/work/zurikey-de-640-3a6cede2.webp", w: 640 },
      ],
      jpg: "/img/work/zurikey-de-400-d4d2fd30.jpg",
      captured: "2026-11-15",
    },
  },
  {
    id: "saporivivi",
    name: "SaporiVivi",
    kind: "own",
    url: "https://saporivivi.ch",
    host: "saporivivi.ch",
    // HTTP 503 «Site Currently Unavailable» (SiteGround suspension), re-checked 2026-11-15.
    // Back with one line: live: true, public: true (and a fresh screenshot).
    live: false,
    public: false,
    checked: "2026-11-15",
  },
];

/** The projects a page may show, in display order: clients first, then own projects. */
export function shownProjects(): Project[] {
  const visible = PROJECTS.filter((p) => p.public && p.live);
  return [...visible.filter((p) => p.kind === "client"), ...visible.filter((p) => p.kind === "own")];
}

/** How many CLIENT projects render (a pending approval still renders, so it counts). */
export function shownClientCount(): number {
  return shownProjects().filter((p) => p.kind === "client").length;
}
