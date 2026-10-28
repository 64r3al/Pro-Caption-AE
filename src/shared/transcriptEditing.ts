import type { TranscriptWord } from "./types";

export interface SuggestedWordTiming {
  start: number;
  end: number;
}

/**
 * Suggests a conservative default for an inserted word without modifying neighboring words.
 * Returns null when the surrounding start times are out of order or invalid, because no
 * insertion can preserve that ordering reliably without first correcting the transcript.
 */
export const suggestInsertedWordTiming = (
  words: readonly TranscriptWord[],
  insertionIndex: number,
  defaultDurationSeconds = 0.2
): SuggestedWordTiming | null => {
  if (!Number.isFinite(insertionIndex)) return null;
  const index = Math.max(0, Math.min(words.length, Math.floor(insertionIndex)));
  const duration =
    Number.isFinite(defaultDurationSeconds) && defaultDurationSeconds > 0
      ? defaultDurationSeconds
      : 0.2;
  const previous = index > 0 ? words[index - 1] : null;
  const next = index < words.length ? words[index] : null;

  if (previous && (
    !Number.isFinite(previous.start) ||
    !Number.isFinite(previous.end) ||
    previous.start < 0 ||
    previous.end < previous.start
  )) return null;
  if (next && (
    !Number.isFinite(next.start) ||
    !Number.isFinite(next.end) ||
    next.start < 0 ||
    next.end < next.start
  )) return null;
  if (previous && next && previous.start > next.start) return null;

  if (previous && next) {
    const start = previous.end < next.start
      ? previous.end + (next.start - previous.end) / 2
      : previous.start + Math.max(0, next.start - previous.start) / 2;
    return { start, end: Math.min(start + duration, next.start) };
  }
  if (previous) return { start: previous.end, end: previous.end + duration };
  if (next) return { start: Math.max(0, next.start - duration), end: next.start };
  return { start: 0, end: duration };
};
