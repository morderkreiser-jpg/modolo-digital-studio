// A fake time source for the call controller and the routes (ControllerClock plus advance()): no
// real timer ever runs. advance(ms) moves the clock forward and runs every timer that falls due,
// in time order, and lets the pending promise work settle before and after each one: the memory
// store and the session lock chain more awaits than a few microtask turns, so it drains with
// setImmediate rather than with resolved promises.
import type { ControllerClock } from "@/lib/voice/server/providers/types";

export interface FakeClock extends ControllerClock {
  /** Moves the clock forward by `ms`, running the timers that fall due on the way. */
  advance(ms: number): Promise<void>;
  /** Timers still waiting (cleared and fired ones not counted). */
  pending(): number;
}

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** Lets pending promise chains (and the timers' own async work) run to their next real wait. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

export function createFakeClock(start = Date.UTC(2026, 11, 2, 9)): FakeClock {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();

  /** The earliest timer due at or before `until`; equal times run in the order they were set. */
  function nextDue(until: number): FakeTimer | null {
    let best: FakeTimer | null = null;
    for (const timer of timers.values()) {
      if (timer.at > until) continue;
      if (best === null || timer.at < best.at || (timer.at === best.at && timer.id < best.id)) best = timer;
    }
    return best;
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
      timers.set(id, { id, at: now + delay, fn });
      return id;
    },
    clearTimeout(handle) {
      if (typeof handle === "number") timers.delete(handle);
    },
    async advance(ms) {
      const until = now + (Number.isFinite(ms) && ms > 0 ? ms : 0);
      await drain();
      for (;;) {
        const timer = nextDue(until);
        if (timer === null) break;
        timers.delete(timer.id);
        now = Math.max(now, timer.at);
        timer.fn();
        await drain();
      }
      now = until;
      await drain();
    },
    pending: () => timers.size,
  };
}
