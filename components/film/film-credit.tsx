"use client";

import type { ProjectId } from "@/data/projects";
import { FILM } from "@/lib/film-media";
import { useFilmShot } from "./film-store";

type Entry = { id: ProjectId; host: string; label: string };

type Props = {
  /** "L" sits under the H1 (Layout L), "P" above the sub (Layout P); the CSS shows exactly one of them. */
  layout: "L" | "P";
  /** One per FILM.projects entry, in film order. Built on the server from the published film variant. */
  entries: readonly Entry[];
  /** Badge before the host: «Online» / «Live». */
  live: string;
  /** The link's accessible name: every site of the film, with what it is (COPY §3). */
  sr: string;
  /** filmShotAt(FILM.startAt[lang]): the shot of the poster; used in SSR and whenever no frame is on screen. */
  posterShot: number;
  className: string;
  stackClassName: string;
  rowClassName: string;
  dotClassName: string;
  liveClassName: string;
  hostClassName: string;
  whatClassName: string;
  srClassName: string;
};

/**
 * The live credit under the H1 (SPEC §2.4): it names the website on screen and what it is, and switches on
 * the cut. One static link to section 01 (#arbeiten), where every site can be opened.
 * - Every row is rendered, stacked in one grid cell; only the current one is visible (visibility, never
 *   display), so the cell keeps the size of the largest row and nothing moves when it switches (CLS 0).
 * - Hard switch: no transition, no animation, no aria-live (it changes every few seconds and must not chatter).
 * - Screen readers get one sentence that names every site of the film; the switching text is aria-hidden.
 * - During a «how» beat (no site on screen) the last site stays named, dimmed, with a hollow dot.
 */
export default function FilmCredit({
  layout,
  entries,
  live,
  sr,
  posterShot,
  className,
  stackClassName,
  rowClassName,
  dotClassName,
  liveClassName,
  hostClassName,
  whatClassName,
  srClassName,
}: Props) {
  const shot = FILM.shots[useFilmShot(posterShot)] ?? FILM.shots[posterShot];
  const credit = shot.credit;

  return (
    <a
      href="#arbeiten"
      className={className}
      data-film-credit={layout}
      data-project={credit}
      data-state={shot.project === null ? "dim" : "lit"}
    >
      <span className={srClassName}>{sr}</span>
      <span aria-hidden="true" className={stackClassName}>
        {entries.map((e) => (
          <span
            key={e.id}
            className={rowClassName}
            data-row={e.id}
            style={{ gridArea: "1 / 1", visibility: e.id === credit ? "visible" : "hidden" }}
          >
            {/* The spaces are not rendered between flex items; they keep the text readable when extracted. */}
            <span className={dotClassName} /> <span className={liveClassName}>{live}</span>{" "}
            <span className={hostClassName}>{e.host}</span> <span className={whatClassName}>{e.label}</span>
          </span>
        ))}
      </span>
    </a>
  );
}
