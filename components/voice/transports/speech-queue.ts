// The queue of sentences the local transport hands to the browser's speech synthesis, and the
// only place that decides when a reply has been spoken. Pure: the platform engine and the timers
// are injected, so tests/voice/transport.test.ts drives it with a fake engine and a fake clock.
//
// Why a queue of our own: a streamed reply is cut into sentences as it arrives, so all of them are
// handed to speechSynthesis almost at once, and the engine plays them one after the other. A
// sentence can therefore wait a long time before it starts (behind a long one), and only then
// play for its own length. Two different clocks follow from that:
//   - a "never started" deadline, armed only when the sentence reaches the head of OUR queue (the
//     previous one ended): long enough for a network voice to load; and when it runs out while
//     the engine is still playing something, it waits again instead of declaring speech broken;
//   - a safety deadline for a sentence that started, armed in its start event, sized from its own
//     length: some engines never report the end of an utterance (Chrome after about 15 s, a
//     removed audio device), and the conversation must not hang there.
// Only a head sentence that never starts while nothing at all is playing means that speech
// output does not work here: then the queue says so once and plays nothing more.

/** What the engine reports about one utterance. Wired by the caller to the platform's events. */
export interface SpeechCallbacks {
  start(): void;
  end(): void;
  /** The platform's error code ("interrupted", "canceled", "synthesis-failed"...). */
  error(code: string): void;
  boundary(): void;
}

/** The platform speech engine (window.speechSynthesis in the browser). */
export interface SpeechEngine {
  /** Queues one utterance wired to `callbacks`. May throw: the queue then treats speech as broken. */
  speak(text: string, callbacks: SpeechCallbacks): void;
  /** Drops everything the engine holds. Its error events for the dropped utterances are ignored. */
  cancel(): void;
  /** Something is coming out of the speakers right now (speechSynthesis.speaking). */
  speaking(): boolean;
}

export interface QueueClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpeechTiming {
  /** A slow speaking pace: a started sentence that has not ended at this pace (plus margin) is stuck. */
  charsPerSecond: number;
  marginMs: number;
  /** How long the head sentence may take to start (first use of a network voice included). */
  startDeadlineMs: number;
  /** How often that deadline is renewed while the engine is busy with something else. */
  maxStartWaits: number;
}

export const SPEECH_TIMING: SpeechTiming = {
  charsPerSecond: 9,
  marginMs: 4_000,
  startDeadlineMs: 5_000,
  maxStartWaits: 3,
};

export interface SpeechQueueOptions {
  engine: SpeechEngine;
  clock?: QueueClock;
  timing?: Partial<SpeechTiming>;
  /** A sentence of ours started to play. */
  onStart(): void;
  /** The engine reached a word boundary (the orb's speaking rhythm uses it). */
  onBoundary?(): void;
  /** Nothing of ours is waiting or playing any more (after an end, a give-up or a failure). */
  onDrained(): void;
  /** Speech output does not work on this device. Called once; the queue speaks nothing afterwards. */
  onBroken(): void;
}

export interface SpeechQueue {
  /** Queues one sentence. Does nothing once speech is known to be broken. */
  speak(text: string): void;
  /** Stops everything at once (barge-in, end of the conversation). No callback follows. */
  cancel(): void;
  /** Sentences queued or playing. */
  pending(): number;
  /** False once speech output turned out not to work. */
  works(): boolean;
}

const BROWSER_CLOCK: QueueClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Errors that are ours (barge-in, cancel) and say nothing about the engine. */
const OWN_ERRORS: ReadonlySet<string> = new Set(["interrupted", "canceled"]);

interface Item {
  text: string;
  state: "queued" | "playing";
  timer: unknown;
  waits: number;
}

export function createSpeechQueue(options: SpeechQueueOptions): SpeechQueue {
  const clock = options.clock ?? BROWSER_CLOCK;
  const timing: SpeechTiming = { ...SPEECH_TIMING, ...options.timing };
  const { engine } = options;
  let items: Item[] = [];
  /** Bumped by every reset: events of utterances from before it are ignored. */
  let generation = 0;
  let working = true;

  const clearTimer = (item: Item) => {
    if (item.timer !== null) clock.clearTimeout(item.timer);
    item.timer = null;
  };

  const arm = (item: Item, ms: number, fire: () => void) => {
    clearTimer(item);
    item.timer = clock.setTimeout(() => {
      item.timer = null;
      fire();
    }, ms);
  };

  const isSpeaking = (): boolean => {
    try {
      return engine.speaking();
    } catch {
      return false;
    }
  };

  /** Forgets every sentence and silences the engine. Calls nothing back. */
  const reset = () => {
    generation += 1;
    for (const item of items) clearTimer(item);
    items = [];
    try {
      engine.cancel();
    } catch {
      // Nothing to cancel.
    }
  };

  const drainAfterReset = (hadItems: boolean) => {
    if (hadItems) options.onDrained();
  };

  const breakDown = () => {
    const hadItems = items.length > 0;
    reset();
    if (working) {
      working = false;
      options.onBroken();
    }
    drainAfterReset(hadItems);
  };

  const finish = (item: Item) => {
    const index = items.indexOf(item);
    if (index === -1) return;
    clearTimer(item);
    items.splice(index, 1);
    const head = items[0];
    if (head && head.state === "queued" && head.timer === null) armStart(head);
    if (items.length === 0) options.onDrained();
  };

  const begin = (item: Item) => {
    // The engine plays in order: anything of ours before this one has ended, even if it never
    // said so (a lost end event). Dropped without a callback, the reply is not over yet.
    while (items.length > 0 && items[0] !== item) {
      const earlier = items.shift();
      if (earlier) clearTimer(earlier);
    }
    item.state = "playing";
    arm(item, (item.text.length / timing.charsPerSecond) * 1000 + timing.marginMs, () => finish(item));
    options.onStart();
  };

  function armStart(item: Item): void {
    arm(item, timing.startDeadlineMs, () => {
      if (!items.includes(item) || item.state !== "queued") return;
      const busy = isSpeaking();
      if (busy && item.waits < timing.maxStartWaits) {
        // Something is still playing (a sentence whose end was not reported, the unlock
        // utterance): not a failure yet.
        item.waits += 1;
        armStart(item);
        return;
      }
      if (!busy) {
        // Nothing plays and ours never started: this device does not speak.
        breakDown();
        return;
      }
      // The engine has been "speaking" for a long time without ever getting to ours: it is stuck.
      // Cancelling resets it; the next reply tries again.
      const hadItems = items.length > 0;
      reset();
      drainAfterReset(hadItems);
    });
  }

  return {
    speak(text: string) {
      if (!working || text.trim() === "") return;
      const item: Item = { text, state: "queued", timer: null, waits: 0 };
      items.push(item);
      const itemGeneration = generation;
      const live = () => itemGeneration === generation && items.includes(item);
      const callbacks: SpeechCallbacks = {
        start: () => {
          if (live() && item.state === "queued") begin(item);
        },
        boundary: () => {
          if (!live()) return;
          // An engine that skips the start event still reports words: it is playing.
          if (item.state === "queued") begin(item);
          options.onBoundary?.();
        },
        end: () => {
          if (live()) finish(item);
        },
        error: (code: string) => {
          if (!live()) return;
          if (OWN_ERRORS.has(code)) finish(item);
          else breakDown();
        },
      };
      try {
        engine.speak(text, callbacks);
      } catch {
        breakDown();
        return;
      }
      if (items[0] === item && item.state === "queued" && item.timer === null) armStart(item);
    },
    cancel() {
      reset();
    },
    pending() {
      return items.length;
    },
    works() {
      return working;
    },
  };
}
