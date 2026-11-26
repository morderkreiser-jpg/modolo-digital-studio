// The recordings of the audio test tool (tests/voice/live/audio-cli.ts): a WAV file (RIFF, PCM
// 16-bit, 1 or 2 channels, any rate) becomes mono 16-bit PCM at 24 000 Hz, the format the realtime
// session takes, split into chunks of 100 ms. Anything else is refused with a message the owner
// can act on (in Italian, like every message of the tool).
import { readFileSync, statSync } from "node:fs";

/** The rate of the realtime session's raw PCM (openai-session.ts PCM_FORMAT). */
export const TARGET_RATE = 24_000;
/** 100 ms of mono 16-bit PCM at 24 kHz. */
export const CHUNK_BYTES = 4_800;
export const CHUNK_MS = 100;
/** Longest recording of one turn. */
export const MAX_WAV_SECONDS = 30;
/** Largest WAV file. */
export const MAX_WAV_BYTES = 10 * 1024 * 1024;
/** Rates outside this range are not recordings. */
const MIN_RATE = 1_000;
const MAX_RATE = 384_000;

const FORMAT_PCM = 1;
const FORMAT_EXTENSIBLE = 0xfffe;

export interface PcmAudio {
  /** Mono 16-bit little-endian PCM at TARGET_RATE. */
  pcm: Buffer;
  seconds: number;
  sourceRate: number;
  sourceChannels: 1 | 2;
}

export type WavResult = ({ ok: true } & PcmAudio) | { ok: false; reason: string };

/** Decodes a WAV file's bytes and resamples them to mono 24 kHz. Never throws. */
export function decodeWav(bytes: Buffer): WavResult {
  if (bytes.length > MAX_WAV_BYTES) return { ok: false, reason: `il file è più grande di ${MAX_WAV_BYTES / 1024 / 1024} MB.` };
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return { ok: false, reason: "non è un file WAV (RIFF/WAVE)." };
  }
  let format: { tag: number; channels: number; rate: number; bits: number; blockAlign: number } | null = null;
  let data: Buffer | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    // A recorder that stopped early may leave a data size larger than the file: take what is there.
    const end = Math.min(bytes.length, start + size);
    if (id === "fmt ") {
      if (end - start < 16) return { ok: false, reason: "l'intestazione del formato (fmt) è troppo corta." };
      let tag = bytes.readUInt16LE(start);
      if (tag === FORMAT_EXTENSIBLE && end - start >= 26) tag = bytes.readUInt16LE(start + 24);
      format = {
        tag,
        channels: bytes.readUInt16LE(start + 2),
        rate: bytes.readUInt32LE(start + 4),
        blockAlign: bytes.readUInt16LE(start + 12),
        bits: bytes.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = bytes.subarray(start, end);
    }
    // Chunks are padded to an even size.
    offset = start + size + (size % 2);
  }
  if (format === null) return { ok: false, reason: "manca l'intestazione del formato (fmt)." };
  if (data === null) return { ok: false, reason: "mancano i dati audio (data)." };
  if (format.tag !== FORMAT_PCM || format.bits !== 16) {
    return { ok: false, reason: "formato non supportato: serve PCM a 16 bit (WAV non compresso). Riesporta la registrazione in «WAV PCM 16 bit»." };
  }
  if (format.channels !== 1 && format.channels !== 2) return { ok: false, reason: `${format.channels} canali: servono 1 (mono) o 2 (stereo).` };
  if (!Number.isInteger(format.rate) || format.rate < MIN_RATE || format.rate > MAX_RATE) {
    return { ok: false, reason: `frequenza di campionamento ${format.rate} Hz non valida.` };
  }
  const channels = format.channels;
  const frameBytes = 2 * channels;
  const frames = Math.floor(data.length / frameBytes);
  if (frames === 0) return { ok: false, reason: "la registrazione è vuota." };
  const seconds = frames / format.rate;
  if (seconds > MAX_WAV_SECONDS) return { ok: false, reason: `la registrazione dura ${seconds.toFixed(1)} s: al massimo ${MAX_WAV_SECONDS} s per frase.` };

  // Mono: the mean of the two channels.
  const mono = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const at = frame * frameBytes;
    mono[frame] = channels === 1 ? data.readInt16LE(at) : (data.readInt16LE(at) + data.readInt16LE(at + 2)) / 2;
  }
  return { ok: true, pcm: resampleLinear(mono, format.rate, TARGET_RATE), seconds, sourceRate: format.rate, sourceChannels: channels };
}

/** Reads and decodes one WAV file; the size is checked before the file is read. Never throws. */
export function readWavFile(file: string): WavResult {
  try {
    const size = statSync(file).size;
    if (size > MAX_WAV_BYTES) return { ok: false, reason: `il file è più grande di ${MAX_WAV_BYTES / 1024 / 1024} MB.` };
    return decodeWav(readFileSync(file));
  } catch {
    return { ok: false, reason: "il file non esiste o non si legge." };
  }
}

/** Linear interpolation from `fromRate` to `toRate`, as 16-bit little-endian PCM. */
export function resampleLinear(samples: Float64Array, fromRate: number, toRate: number): Buffer {
  const length = fromRate === toRate ? samples.length : Math.max(1, Math.floor((samples.length * toRate) / fromRate));
  const out = Buffer.alloc(length * 2);
  for (let index = 0; index < length; index += 1) {
    const position = (index * fromRate) / toRate;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    const a = samples[Math.min(left, samples.length - 1)];
    const value = a + (samples[right] - a) * fraction;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), index * 2);
  }
  return out;
}

/** The PCM split into chunks of CHUNK_BYTES (the last one may be shorter). */
export function chunkPcm(pcm: Buffer, size = CHUNK_BYTES): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += size) chunks.push(pcm.subarray(offset, Math.min(pcm.length, offset + size)));
  return chunks;
}

/** `ms` of silence as chunks of CHUNK_BYTES (turn detection needs audio that goes on). */
export function silenceChunks(ms: number): Buffer[] {
  const count = Math.max(0, Math.ceil(ms / CHUNK_MS));
  return Array.from({ length: count }, () => Buffer.alloc(CHUNK_BYTES));
}

/** A WAV file of 16-bit PCM from interleaved samples. For the tests and the owner's own checks. */
export function encodeWav(samples: Int16Array, rate: number, channels: 1 | 2): Buffer {
  const dataBytes = samples.length * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(FORMAT_PCM, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) out.writeInt16LE(samples[index], 44 + index * 2);
  return out;
}

/** A sine tone as a WAV file (the same tone on both channels of a stereo file). */
export function sineWav(options: { seconds: number; rate: number; channels: 1 | 2; hz?: number; amplitude?: number }): Buffer {
  const frames = Math.round(options.seconds * options.rate);
  const hz = options.hz ?? 440;
  const amplitude = options.amplitude ?? 8000;
  const samples = new Int16Array(frames * options.channels);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(amplitude * Math.sin((2 * Math.PI * hz * frame) / options.rate));
    for (let channel = 0; channel < options.channels; channel += 1) samples[frame * options.channels + channel] = value;
  }
  return encodeWav(samples, options.rate, options.channels);
}
