// What the local transport may ask of the device's audio, decided once per conversation from the
// browser's own description of itself. Pure, unit-tested (tests/voice/transport.test.ts).
//
// Phones are treated with care, on purpose and without proof either way (no phone was tested):
//   - Android hands speech recognition to a system service that wants the microphone for itself;
//     a getUserMedia stream kept open next to it (only for the orb's level meter) can leave
//     recognition with "audio-capture" or with nothing to hear.
//   - iOS runs speech output and speech input through one audio session; starting recognition
//     while an answer is being read can duck it, move it to the earpiece or cut it.
// So on phones the microphone stream only serves the permission prompt and is closed at once,
// the orb's level comes from what recognition hears, and recognition waits until the answer has
// been read (no interrupting by voice; typing still interrupts). Desktop browsers keep both.

export interface SpeechPlatform {
  /** Keep a getUserMedia stream open next to speech recognition, for the orb's level meter. */
  holdsMeterStream: boolean;
  /** Run speech recognition while the answer is being read (interrupting by voice). */
  listensWhileSpeaking: boolean;
}

export interface NavigatorFacts {
  userAgent?: string;
  /** Deprecated but still the one way to spot an iPad that asks for desktop pages. */
  platform?: string;
  maxTouchPoints?: number;
}

export function speechPlatform(facts: NavigatorFacts | null | undefined): SpeechPlatform {
  const agent = facts?.userAgent ?? "";
  const iOS = /\b(iPhone|iPad|iPod)\b/.test(agent) || (facts?.platform === "MacIntel" && (facts.maxTouchPoints ?? 0) > 1);
  const android = /\bAndroid\b/i.test(agent);
  const phone = iOS || android;
  return { holdsMeterStream: !phone, listensWhileSpeaking: !phone };
}
