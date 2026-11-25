// Text helpers of the local transport, kept pure so they are unit-tested without a browser:
// cutting a streamed reply into sentences for speech synthesis, picking a synthesis voice, and
// telling the caller's speech apart from our own voice coming back through the speakers.
import { VOICE_LANG_TAG, type VoiceLocale } from "@/lib/voice/types";

/** Longer utterances are split: Chrome stops speaking a single utterance after about 15 s. */
export const MAX_UTTERANCE_CHARS = 180;

// Words that end in a period without ending the sentence (de, it, en, fr). Compared lowercased,
// without the period. Single letters ("z. B.", "S. 4") and numbers ("am 3. Dezember") are
// handled by rule, not listed.
const ABBREVIATIONS = new Set([
  "bzw",
  "ca",
  "dr",
  "etc",
  "evtl",
  "inkl",
  "max",
  "min",
  "mio",
  "mr",
  "mrs",
  "ms",
  "nr",
  "prof",
  "sig",
  "sr",
  "st",
  "str",
  "tel",
  "usw",
  "vgl",
  "ecc",
  "geom",
  "dott",
  "avv",
  "mme",
  "mlle",
  "env",
  "vs",
]);

/**
 * Takes the complete sentences off the front of `buffer`. A sentence ends at . ! ? … (with any
 * closing quotes or brackets) followed by white space, or at a line break; not after an
 * abbreviation, a single letter or a number. With `final` the rest counts as the last sentence.
 * Sentences longer than MAX_UTTERANCE_CHARS are cut at a comma or, failing that, a space.
 */
export function takeSentences(buffer: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  const pattern = /([.!?…]+)["»”’')\]]*(?=\s)|\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    if (match[0] !== "\n" && match[1] === "." && !endsSentence(buffer.slice(start, match.index))) continue;
    pushSentence(sentences, buffer.slice(start, end));
    start = end;
  }
  let rest = buffer.slice(start).replace(/^\s+/, "");
  if (final) {
    pushSentence(sentences, rest);
    rest = "";
  } else if (rest.length > MAX_UTTERANCE_CHARS * 1.5) {
    // A run-on reply without a period: speak what is there rather than wait for the end.
    const cut = cutPoint(rest, MAX_UTTERANCE_CHARS);
    pushSentence(sentences, rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  return { sentences, rest };
}

function endsSentence(text: string): boolean {
  const word = /(\S+)$/.exec(text)?.[1] ?? "";
  const bare = word.replace(/^[("«“‘'[]+/, "").toLowerCase();
  if (bare === "") return true;
  if (/^\d+$/.test(bare)) return false; // ordinals and dates: "am 3. Dezember"
  if (/^\p{L}$/u.test(bare)) return false; // "z. B.", "S. 4"
  if (/\.\p{L}$/u.test(bare)) return false; // "z.B", "e.g"
  return !ABBREVIATIONS.has(bare);
}

function pushSentence(sentences: string[], raw: string): void {
  let text = raw.trim();
  while (text.length > MAX_UTTERANCE_CHARS) {
    const cut = cutPoint(text, MAX_UTTERANCE_CHARS);
    const head = text.slice(0, cut).trim();
    if (head) sentences.push(head);
    text = text.slice(cut).trim();
  }
  if (text) sentences.push(text);
}

/** Where to cut a long text at or before `max`: after a comma, semicolon or colon, else at a space. */
function cutPoint(text: string, max: number): number {
  const window = text.slice(0, max);
  const punctuation = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
  if (punctuation > max * 0.4) return punctuation + 1;
  const space = window.lastIndexOf(" ");
  return space > max * 0.4 ? space : max;
}

/**
 * What the synthesiser should read: markdown marks, list bullets and URLs out (the model is told
 * to speak plainly, but a stray asterisk read aloud sounds broken).
 */
export function toSpeakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------------------------

/** The part of SpeechSynthesisVoice the choice needs (a real voice object satisfies it). */
export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

/** Regions tried in order when the exact Swiss tag is missing. */
const REGION_ORDER: Record<VoiceLocale, string[]> = {
  de: ["ch", "de", "at", "li"],
  it: ["ch", "it"],
  en: ["gb", "ie", "us", "au", "ca"],
  fr: ["ch", "fr", "be", "ca"],
};

// Names that mark the better voices of each platform (Google's network voices, Apple's enhanced
// and premium downloads, Microsoft's natural ones).
const QUALITY = /(premium|enhanced|natural|neural|google|siri)/i;
// Novelty voices macOS ships under every language tag.
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|hysterical|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/**
 * The best installed voice for `locale`: the exact tag of VOICE_LANG_TAG (de-CH, it-CH, en-GB,
 * fr-CH), else the same language in REGION_ORDER, else any voice of that language. Within a
 * group a known good voice wins, then the platform default. null when the language has no voice
 * at all (the utterance's lang attribute then lets the browser decide).
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], locale: VoiceLocale): V | null {
  const tag = VOICE_LANG_TAG[locale].toLowerCase();
  const usable = voices.filter((voice) => !NOVELTY.test(voice.name));
  const normalized = (voice: V) => voice.lang.replace(/_/g, "-").toLowerCase();
  const sameLanguage = usable.filter((voice) => normalized(voice).split("-")[0] === locale);
  if (sameLanguage.length === 0) return null;

  const exact = sameLanguage.filter((voice) => normalized(voice) === tag);
  if (exact.length > 0) return best(exact);
  for (const region of REGION_ORDER[locale]) {
    const inRegion = sameLanguage.filter((voice) => normalized(voice) === `${locale}-${region}`);
    if (inRegion.length > 0) return best(inRegion);
  }
  return best(sameLanguage);
}

function best<V extends VoiceLike>(voices: readonly V[]): V {
  return (
    voices.find((voice) => QUALITY.test(voice.name)) ??
    voices.find((voice) => voice.default === true) ??
    voices[0]
  );
}

// ---------------------------------------------------------------------------------------------
// Language of a reply
// ---------------------------------------------------------------------------------------------

// Short, frequent words that mostly belong to one of the four languages. Compared after words()
// (lower case, accents removed: "für" is "fur", "sì" is "si"). Words two of them share in writing
// are left out on purpose: la, le, il, in, a, un, non, si, ai, on, du, des, alle, come, was, die.
const LANGUAGE_MARKERS: Record<VoiceLocale, ReadonlySet<string>> = {
  de: new Set(
    "der das und ist ich nicht ein eine einen dem den mit fur auf wir haben habe gerne gern bitte danke uhr termin wie wann noch auch sind kann konnen ihnen ihr oder sie wird gibt leider morgen heute".split(" "),
  ),
  it: new Set(
    "lo gli di che una per con sono mi ti ci ho della del alla grazie prego buongiorno quando ancora anche puo possiamo abbiamo appuntamento ore domani oggi purtroppo".split(" "),
  ),
  en: new Set(
    "the and is you not to with for it we have has please thank thanks what when how can could your are be yes appointment of at would there".split(" "),
  ),
  fr: new Set(
    "et est je vous ne pas une pour avec sur dans nous avez merci bonjour comment quand peut pouvez votre oui rendez demain aujourd hui au".split(" "),
  ),
};

/**
 * The language `text` is most likely written in, or null when it is too short or too mixed to
 * tell. The model answers in the language the caller actually used, which need not be the
 * widget's: the reply must then be read by a voice of that language and captioned with its lang.
 * At least two marker words, and clearly more than any other language.
 */
export function detectReplyLocale(text: string): VoiceLocale | null {
  const tokens = words(text);
  let best: VoiceLocale | null = null;
  let bestScore = 0;
  let second = 0;
  for (const locale of Object.keys(LANGUAGE_MARKERS) as VoiceLocale[]) {
    const markers = LANGUAGE_MARKERS[locale];
    const score = tokens.filter((token) => markers.has(token)).length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = locale;
    } else if (score > second) {
      second = score;
    }
  }
  if (best === null || bestScore < 2 || bestScore < second * 2) return null;
  return best;
}

// ---------------------------------------------------------------------------------------------
// Echo and barge-in
// ---------------------------------------------------------------------------------------------

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * True when what the recogniser heard is most likely the assistant's own voice picked up by the
 * microphone: most of its words are words the assistant has just said. Speech recognition gets no
 * echo cancellation in every browser, and an assistant interrupting itself is worse than a missed
 * interruption (the caller can simply speak again when it stops).
 */
export function isEcho(heard: string, spoken: string, threshold = 0.6): boolean {
  const heardWords = words(heard);
  if (heardWords.length === 0) return true;
  const spokenWords = new Set(words(spoken));
  if (spokenWords.size === 0) return false;
  const overlap = heardWords.filter((word) => spokenWords.has(word)).length;
  return overlap / heardWords.length >= threshold;
}
