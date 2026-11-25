"use client";

// The full transcript of the conversation, behind the stage's "show the whole conversation"
// toggle. A lazy chunk: most visitors never open it. Each line carries its own lang attribute,
// and who said it is written out, not shown by colour alone. After a written example it ends with
// what the business receives (`after`, rendered by the stage), as the caption box does.
import type { ReactNode } from "react";
import { VOICE_LANG_TAG } from "@/lib/voice/types";
import type { VoiceCaption } from "./voice-machine";
import styles from "./voice-stage.module.css";

export interface VoiceTranscriptProps {
  id: string;
  captions: readonly VoiceCaption[];
  title: string;
  empty: string;
  assistantLabel: string;
  callerLabel: string;
  /** Shown after the last line: what the business receives after a written example. */
  after?: ReactNode;
}

export default function VoiceTranscript({ id, captions, title, empty, assistantLabel, callerLabel, after }: VoiceTranscriptProps) {
  return (
    // Focusable, so a keyboard can scroll a long transcript.
    <section id={id} className={styles.transcript} aria-label={title} tabIndex={0} data-lenis-prevent="">
      {captions.length === 0 ? (
        <p className={styles.transcriptEmpty}>{empty}</p>
      ) : (
        <ol className={styles.transcriptList}>
          {captions.map((caption) => (
            <li key={caption.id} className={styles.transcriptLine} data-role={caption.role}>
              <span className={styles.lineRole}>{caption.role === "assistant" ? assistantLabel : callerLabel}</span>
              <span className={styles.lineText} lang={VOICE_LANG_TAG[caption.locale]}>
                {caption.text}
              </span>
            </li>
          ))}
        </ol>
      )}
      {after ? <div className={styles.transcriptAfter}>{after}</div> : null}
    </section>
  );
}
