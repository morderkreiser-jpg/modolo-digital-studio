// Section 01 · Arbeiten (SPEC §4.1, D11, D17, D18, D20, D29). Server component.
//
// The cream sheet that slides over the bottom of the hero film: margin-top −28 px (−20 px on
// phones), top radius 28/20, stacked above the hero. Real work only, named and linked: the film
// shows his sites on screens and its credit links here (#arbeiten), where the visitor can open them.
//
// What renders comes from data/projects.ts (`public && live`); the words from content/home/work.ts.
// - Featured project = the first shown project with a phone screenshot (BJ Studio): its phone sits
//   in the sticky panel on the right (desktop) / under the lead (phone).
// - The others are rows with a small desktop screenshot. A project with `approval` set shows the
//   «Nur Vorschau» badge in every environment (D29). Own projects are labelled as own (never «Kunde»).
// - The lead is singular while BJ Studio is the only rendered client, plural from two clients (D17).
//   With no matching variant it is left out rather than saying something untrue.
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { WORK } from "@/content/home/work";
import { PREFILL } from "@/content/home/prefills";
import { shownProjects, type Project, type ProjectShot } from "@/data/projects";
import WorkCta from "@/components/home/work-cta";

// Scoped CSS, hoisted into <head> once by React (href + precedence). Hand-written for the same
// reason as .mds-split-*: the column layout is the substance here and must not depend on which
// grid utilities the Tailwind build emits. Fallback values let it work before globals.css gets
// --sheet-radius / --nav-h / --live-green (SPEC §5.6).
const CSS = `
.mds-work{--_r:var(--sheet-radius,28px);position:relative;z-index:2;margin-top:calc(-1 * var(--_r));border-radius:var(--_r) var(--_r) 0 0;scroll-margin-top:calc(var(--nav-h,80px) + 12px)}
/* Same query as the hero's Layout P (PORTRAIT_MQ in lib/film-media.ts): the sheet and the film agree on 20 px. */
@media (max-width:767px),(orientation:portrait) and (max-aspect-ratio:4/5){.mds-work{--_r:var(--sheet-radius,20px)}}
.mds-work-alias{display:block;height:0;scroll-margin-top:calc(var(--nav-h,80px) + 12px)}
.mds-work-grid{display:grid;grid-template-columns:minmax(0,1fr);row-gap:32px}
.mds-work-head,.mds-work-list,.mds-work-panel{min-width:0}
@media (min-width:1024px){
  .mds-work-grid{grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-areas:"head panel" "list panel";grid-template-rows:auto 1fr;column-gap:clamp(3rem,5vw,5.5rem);row-gap:0}
  .mds-work-head{grid-area:head}
  .mds-work-list{grid-area:list;padding-top:48px}
  .mds-work-panel{grid-area:panel;align-self:start;position:sticky;top:calc(var(--nav-h,80px) + 24px)}
}
.mds-work-stage{background:var(--ink-panel,#efe6d6);border-radius:20px;padding:20px 16px 14px;display:flex;flex-direction:column;align-items:center}
@media (min-width:768px){.mds-work-stage{border-radius:28px;padding:56px 40px 32px}}
.mds-phone{display:block;width:160px;padding:5px;border-radius:26px;background:#17130e;box-shadow:0 1px 0 rgb(255 255 255 / .06) inset,0 30px 60px -30px rgb(23 19 14 / .55),0 10px 24px -12px rgb(23 19 14 / .35);transition:transform .5s cubic-bezier(.16,1,.3,1)}
@media (min-width:768px){.mds-phone{width:280px;padding:8px;border-radius:36px}}
/* Sticky panel must fit short laptop screens (1366x768, 1280x720): the phone shrinks with the
   viewport height. 2.094 = height/width of the BJ capture (1131/540); 276 = nav + gaps + panel
   padding + caption + bezel. */
@media (min-width:1024px){.mds-phone{width:min(280px,max(216px,calc((100svh - 276px) / 2.094 + 16px)))}}
.mds-phone img{display:block;width:100%;height:auto;border-radius:21px;background:#f3ece2}
@media (min-width:768px){.mds-phone img{border-radius:28px}}
@media (hover:hover) and (prefers-reduced-motion:no-preference){a.mds-phone:hover{transform:translateY(-4px)}}
.mds-work-caption{margin-top:12px;font-size:12.5px;line-height:1.45;color:rgb(23 19 14 / .66);text-align:center;text-wrap:balance}
@media (min-width:768px){.mds-work-caption{margin-top:24px;font-size:13px}}
.mds-seg{white-space:nowrap}
.mds-work-bullets{margin-top:16px;display:grid;gap:8px}
.mds-work-bullets li{display:grid;grid-template-columns:18px minmax(0,1fr);align-items:baseline}
.mds-work-bullets li::before{content:"";width:10px;height:1.5px;background:var(--gilt,#7e5d24);transform:translateY(-4px)}
.mds-pill-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px}
.mds-pill{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 16px 0 18px;border:1px solid rgb(23 19 14 / .18);border-radius:999px;background:rgb(255 255 255 / .35);font-family:var(--font-space),system-ui,sans-serif;font-weight:500;font-size:14.5px;letter-spacing:-.01em;color:#17130e;transition:border-color .2s,background-color .2s}
.mds-pill:hover{border-color:var(--gilt,#7e5d24);background:rgb(255 255 255 / .7)}
.mds-pill-arrow{font-size:16px;line-height:1;color:var(--gilt,#7e5d24);transition:transform .2s}
.mds-pill:hover .mds-pill-arrow{transform:translate(2px,-2px)}
.mds-live{width:7px;height:7px;border-radius:999px;background:var(--live-green,#2b8a50);box-shadow:0 0 0 3px rgb(43 138 80 / .16);flex:none}
.mds-badge{display:inline-flex;align-items:center;min-height:30px;padding:3px 12px;border:1px dashed var(--gilt,#7e5d24);border-radius:999px;font-size:12px;font-weight:500;line-height:1.3;color:var(--gilt,#7e5d24)}
/* Rows (every project after the featured one). Narrow columns (phones, and the 1024-1279 split): label on its own line,
   then thumbnail with name + link beside it, then text and badge. Wide split (>=1280): thumbnail
   on the left of everything. */
.mds-work-row{display:grid;grid-template-columns:112px minmax(0,1fr);grid-template-areas:"label label" "thumb title" "thumb pill" "body body" "badge badge";column-gap:16px;row-gap:10px;align-items:center;padding-top:28px;border-top:1px solid var(--gold-line,rgba(31,27,22,.12))}
.mds-work-row-pill{grid-area:pill;display:flex}
.mds-work-row-badge{grid-area:badge;display:flex}
.mds-work-row-body{margin-top:6px}
.mds-work-row + .mds-work-row{margin-top:28px}
.mds-work-row-label{grid-area:label}
.mds-work-thumb{grid-area:thumb;display:block;border-radius:8px;overflow:hidden;border:1px solid rgb(23 19 14 / .12);box-shadow:0 12px 24px -16px rgb(23 19 14 / .45);background:#e9e0cf}
.mds-work-thumb img{display:block;width:100%;height:auto;transition:transform .6s cubic-bezier(.16,1,.3,1)}
@media (hover:hover) and (prefers-reduced-motion:no-preference){.mds-work-thumb:hover img{transform:scale(1.04)}}
.mds-work-row-title{grid-area:title}
.mds-work-row-body{grid-area:body}
/* An own project keeps its text on phones too: it says what ZüriKey is and that it is not client work. */
@media (min-width:1280px){
  .mds-work-row{grid-template-columns:176px minmax(0,1fr);grid-template-areas:"thumb label" "thumb title" "thumb body" "thumb pill" "thumb badge";grid-template-rows:auto auto auto auto 1fr;column-gap:24px;row-gap:8px;align-items:start}
  .mds-work-row-body{margin-top:2px}
  .mds-work-row-pill{margin-top:8px}
}
.mds-work-cta{display:inline-flex;align-items:center;gap:10px;min-height:44px;font-family:var(--font-space),system-ui,sans-serif;font-weight:500;font-size:16px;letter-spacing:-.01em;color:#17130e;transition:color .2s}
.mds-work-cta > span:first-child{text-decoration:underline;text-decoration-color:var(--gilt,#7e5d24);text-decoration-thickness:1px;text-underline-offset:6px}
.mds-work-cta:hover{color:var(--gilt,#7e5d24)}
.mds-work-cta-arrow{color:var(--gilt,#7e5d24);transition:transform .2s}
.mds-work-cta:hover .mds-work-cta-arrow{transform:translateX(3px)}
`;

/** German UI words quoted inside IT/EN copy get lang="de" (COPY §0, SPEC §5.8). */
function markGerman(text: string, lang: Locale): ReactNode {
  if (lang === "de") return text;
  return text.split(/(Termin buchen)/).map((part, i) =>
    part === "Termin buchen" ? (
      <span key={i} lang="de">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** «Kunde · Umzugsfirma · Uster»: lines may break only between segments, never inside
 *  «Zürich-Schwamendingen» (the hyphen made «ZÜRICH-» / «SCHWAMENDINGEN» on phones). */
function Segments({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          <span className="mds-seg">
            {part}
            {i < parts.length - 1 ? " ·" : ""}
          </span>
          {i < parts.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

function Shot({ shot, alt, sizes, className }: { shot: ProjectShot; alt: string; sizes: string; className?: string }) {
  const set = (list: ProjectShot["avif"]) => list.map((f) => `${f.src} ${f.w}w`).join(", ");
  return (
    <picture>
      <source type="image/avif" srcSet={set(shot.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={set(shot.webp)} sizes={sizes} />
      {/* Plain <img>: hashed static files with their own AVIF/WebP set; next/image would re-encode them. */}
      <img src={shot.jpg} alt={alt} width={shot.width} height={shot.height} loading="lazy" decoding="async" className={className} />
    </picture>
  );
}

function Pill({ project, label, srNewTab }: { project: Project; label: string; srNewTab: string }) {
  return (
    <a href={project.url} target="_blank" rel="noopener noreferrer" className="mds-pill">
      <span className="mds-live" aria-hidden="true" />
      <span>{label}</span>
      <span className="mds-pill-arrow" aria-hidden="true">
        ↗
      </span>
      <span className="sr-only">{srNewTab}</span>
    </a>
  );
}

export default function Work({ lang }: { lang: Locale }) {
  const t = WORK[lang];
  const shown = shownProjects();
  const clients = shown.filter((p) => p.kind === "client");
  const featured = shown.find((p) => p.shot?.frame === "phone");
  const rows = shown.filter((p) => p !== featured);

  const lead =
    clients.length >= 2 ? t.leadManyClients : clients.length === 1 && clients[0].id === "bjstudio" ? t.leadOneClient : null;

  if (shown.length === 0) return null;

  return (
    <section id="arbeiten" aria-labelledby="arbeiten-title" className="mds-work bg-[var(--ink-bg)] px-6 py-16 text-[#17130e] sm:px-10 md:py-32 lg:px-16">
      <style href="mds-work" precedence="default">
        {CSS}
      </style>
      {/* D20: old in-page anchor kept alive for letters, QR codes and inner pages. */}
      <span id="portfolio" className="mds-work-alias" aria-hidden="true" />

      <div className="mds-work-grid mx-auto max-w-[1400px]">
        <header className="mds-work-head">
          <p className="micro-caps text-[var(--gilt)]">{t.kicker}</p>
          <h2 id="arbeiten-title" className="section-head display-space mt-4">
            <span className="block">{t.h2[0]}</span>
            <em className="block not-italic text-[var(--gilt)]">{t.h2[1]}</em>
          </h2>
          {lead && <p className="mt-6 max-w-[560px] text-[17px] font-light leading-relaxed text-[#17130e]/78 md:text-lg">{lead}</p>}
        </header>

        {featured?.shot && (
          <figure className="mds-work-panel m-0">
            <div className="mds-work-stage">
              <a href={featured.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="mds-phone">
                <Shot shot={featured.shot} alt={t.projects.bjstudio.alt} sizes="(min-width: 768px) 264px, 150px" />
              </a>
              <figcaption className="mds-work-caption">{t.projects.bjstudio.phoneCaption}</figcaption>
            </div>
          </figure>
        )}

        <div className="mds-work-list">
          {featured && featured.id === "bjstudio" && (
            <article aria-labelledby="work-bjstudio">
              <p className="micro-caps text-[var(--gilt)]">
                <Segments text={t.projects.bjstudio.label} />
              </p>
              <h3 id="work-bjstudio" className="display-space mt-3 text-[1.6rem] leading-tight md:text-[1.85rem]">
                {t.projects.bjstudio.h3}
              </h3>
              <ul className="mds-work-bullets text-[15.5px] leading-[1.55] text-[#17130e]/80">
                {t.projects.bjstudio.bullets.map((b) => (
                  <li key={b}>
                    <span>{markGerman(b, lang)}</span>
                  </li>
                ))}
              </ul>
              <div className="mds-pill-row mt-6">
                <Pill project={featured} label={t.projects.bjstudio.pill} srNewTab={t.newTabSrOnly} />
              </div>
            </article>
          )}

          <div className={featured ? "mt-10 md:mt-12" : ""}>
            {rows.map((p) => {
              const copy = p.id === "zumove" ? t.projects.zumove : p.id === "zurikey" ? t.projects.zurikey : null;
              if (!copy) return null; // a project without copy never renders half-labelled
              // D29 fail-safe: a pending approval without a badge string must not render at all.
              if (p.approval && !("pendingBadge" in copy)) return null;
              const body = "facts" in copy ? copy.facts.join(" · ") : copy.text;
              return (
                <article key={p.id} aria-labelledby={`work-${p.id}`} data-kind={p.kind} className="mds-work-row">
                  <p className="mds-work-row-label micro-caps text-[var(--gilt)]">
                    <Segments text={copy.label} />
                  </p>
                  {p.shot && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" className="mds-work-thumb">
                      <Shot shot={p.shot} alt="" sizes="(min-width: 1280px) 176px, 112px" />
                    </a>
                  )}
                  <h3 id={`work-${p.id}`} className="mds-work-row-title display-space text-[1.3rem] leading-tight md:text-[1.45rem]">
                    {p.name}
                  </h3>
                  <div className="mds-work-row-pill">
                    <Pill project={p} label={copy.pill} srNewTab={t.newTabSrOnly} />
                  </div>
                  <p className="mds-work-row-body text-[15px] leading-[1.6] text-[#17130e]/78">{markGerman(body, lang)}</p>
                  {p.approval && "pendingBadge" in copy && (
                    <p className="mds-work-row-badge">
                      <span className="mds-badge">{copy.pendingBadge}</span>
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          <div className="mt-10 border-t border-[color:var(--gold-line)] pt-6 md:mt-12 md:pt-8">
            <WorkCta text={PREFILL[lang].work} label={t.cta} className="mds-work-cta group" />
          </div>
        </div>
      </div>
    </section>
  );
}
