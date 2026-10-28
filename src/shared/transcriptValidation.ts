import type { TranscriptWord } from "./types";

/**
 * Removes unusable words from a transcription response before it enters the caption pipeline.
 * Keeps transcript order, trims whitespace, and does not invent or modify timestamps.
 * Zero-duration words are retained because the frame-sync stage can expand them safely.
 */
export const validateTranscriptWords = (
  input: readonly TranscriptWord[]
): TranscriptWord[] => {
  const out: TranscriptWord[] = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate.text !== "string") continue;
    const text = candidate.text.trim();
    const start = candidate.start;
    const end = candidate.end;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end < start) continue;
    out.push({ text, start, end });
  }
  return out;
};
