"use client";

// The trade chooser of the demo section and the slot where the chosen business's stage plays.
//
// The stages are rendered on the server (one VoiceMount per business, components/voice/landing/
// demo.tsx) and arrive here as finished elements: only the chosen one is in the page, the others
// stay in the RSC payload. Switching mounts a fresh stage (keyed by business), so an example that
// was playing stops and the next one starts clean; the widget's chunks are shared, so the orb and
// the player load once.
//
// The choice follows the URL hash (#demo-hotel): the trade links of the sectors section point
// there, a link to one example can be shared, and no effect is needed to follow it. The server
// renders the default business; after hydration a hash that names another one takes over.
//
// Native radios in a fieldset: one tab stop, arrow keys, the legend as the group's name, and
// nothing to re-implement for screen readers.
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { selectDemoId, type PickedDemo } from "./demo-choice";
import s from "./landing.module.css";

export interface DemoChoice {
  /** The demo tenant's id; also the anchor of its row (#demo-sanitaer). */
  id: string;
  /** The trade in the page's language. */
  label: string;
  /** The example's language code ("DE") when it is not the page's language, else null. */
  languageTag: string | null;
  /** That language for screen readers ("in German"), else null. */
  languageSr: string | null;
  /** The sentence shown above the stage in that case, else null. */
  languageNote: string | null;
  /** The server-rendered stage (VoiceMount). */
  stage: ReactNode;
}

export interface DemoChooserProps {
  /** The radios' name. */
  name: string;
  legend: string;
  choices: DemoChoice[];
  defaultId: string;
  /** Rendered between the chooser and the stage (the copy's "written examples" note). */
  note: ReactNode;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return ""; // a malformed escape in a hand-typed URL is just no choice
  }
}

function serverHash(): string {
  return "";
}

export default function DemoChooser({ name, legend, choices, defaultId, note }: DemoChooserProps) {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  // A choice made here, with the hash it left behind (rules in demo-choice.ts).
  const [picked, setPicked] = useState<PickedDemo | null>(null);

  const selectedId = selectDemoId(
    choices.map((choice) => choice.id),
    hash,
    picked,
    defaultId,
  );
  const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0];

  // On a phone the trades are one row that scrolls sideways (landing.module.css): bring the chosen
  // one into that row's view, without scrolling the page itself (scrollIntoView would).
  const listRef = useRef<HTMLUListElement>(null);
  const shownId = selected?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list || !shownId || list.scrollWidth <= list.clientWidth) return;
    const item = list.querySelector<HTMLElement>('[data-choice="' + CSS.escape(shownId) + '"]');
    if (!item) return;
    const box = list.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
    const rect = item.getBoundingClientRect();
    if (rect.left >= box.left + pad && rect.right <= box.right - pad) return;
    list.scrollLeft += rect.left - box.left - pad;
  }, [shownId]);

  const choose = (id: string) => {
    // The hash records the choice for a shared link; replaceState neither scrolls nor adds a
    // history entry. Browsers may throttle it (Safari), so a refusal only skips the URL.
    try {
      window.history.replaceState(window.history.state, "", `#${encodeURIComponent(id)}`);
    } catch {
      // the choice below still applies
    }
    setPicked({ id, hash: readHash() });
  };

  if (!selected) return null;

  return (
    <>
      <fieldset className={s.chooser}>
        <legend className={s.chooserLegend}>{legend}</legend>
        <ul ref={listRef} className={s.choiceList} role="list">
          {choices.map((choice) => (
            <li key={choice.id} id={choice.id} data-choice={choice.id} className={s.choiceItem}>
              <label className={s.choice}>
                <input
                  type="radio"
                  name={name}
                  value={choice.id}
                  checked={choice.id === selected.id}
                  onChange={() => choose(choice.id)}
                  className={s.choiceInput}
                />
                <span className={s.choiceBody}>
                  <span className={s.choiceLabel}>{choice.label}</span>
                  {choice.languageTag ? (
                    <>
                      <span className={s.langTag} aria-hidden="true">
                        {choice.languageTag}
                      </span>
                      {choice.languageSr ? <span className={s.srOnly}>{`, ${choice.languageSr}`}</span> : null}
                    </>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {note}

      <div className={s.stageSlot}>
        {selected.languageNote ? (
          <p className={s.stageLang}>
            {selected.languageTag ? (
              <span className={s.langTag} aria-hidden="true">
                {selected.languageTag}
              </span>
            ) : null}
            {selected.languageNote}
          </p>
        ) : null}
        <Fragment key={selected.id}>{selected.stage}</Fragment>
      </div>
    </>
  );
}
