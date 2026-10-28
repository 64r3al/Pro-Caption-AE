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


/**
 * Normalizes Groq verbose_json response words. Real word-level timestamps take precedence;
 * segment timestamps are only used when no usable word-level words were returned.
 */
export const normalizeTranscriptWords = (response: unknown): TranscriptWord[] => {
  if (!response || typeof response !== "object") return [];
  const data = response as { words?: unknown; segments?: unknown };

  if (Array.isArray(data.words) && data.words.length) {
    const wordLevel = validateTranscriptWords(
      data.words.map((word: any) => ({
        text: String(word?.word ?? ""),
        start: Number(word?.start),
        end: Number(word?.end),
      }))
    );
    if (wordLevel.length) return wordLevel;
  }

  if (!Array.isArray(data.segments)) return [];
  const fallback: TranscriptWord[] = [];
  for (const segment of data.segments) {
    const parts = String((segment as any)?.text ?? "").trim().split(/\s+/).filter(Boolean);
    const start = Number((segment as any)?.start);
    const end = Number((segment as any)?.end);
    if (!parts.length || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const durationPerWord = (end - start) / parts.length;
    parts.forEach((text: string, index: number) => {
      fallback.push({
        text,
        start: start + durationPerWord * index,
        end: start + durationPerWord * (index + 1),
      });
    });
  }
  return validateTranscriptWords(fallback);
};
