import { describe, expect, it } from "vitest";
import { validateTranscriptWords } from "./transcriptValidation";
import type { TranscriptWord } from "./types";

describe("validateTranscriptWords", () => {
  it("keeps valid words in their original order and trims whitespace", () => {
    const words: TranscriptWord[] = [
      { text: " hello ", start: 0, end: 0.2 },
      { text: "world", start: 0.3, end: 0.5 },
    ];
    expect(validateTranscriptWords(words)).toEqual([
      { text: "hello", start: 0, end: 0.2 },
      { text: "world", start: 0.3, end: 0.5 },
    ]);
  });

  it("rejects empty text, non-finite timestamps, negative starts, and reversed ranges", () => {
    const words = [
      { text: "", start: 0, end: 0.1 },
      { text: "nan", start: Number.NaN, end: 1 },
      { text: "infinite", start: 0, end: Number.POSITIVE_INFINITY },
      { text: "negative", start: -0.01, end: 0.1 },
      { text: "reversed", start: 0.8, end: 0.2 },
    ] as TranscriptWord[];
    expect(validateTranscriptWords(words)).toEqual([]);
  });

  it("does not mutate the input and preserves zero-duration words for frame quantization", () => {
    const words: TranscriptWord[] = [{ text: "word", start: 1, end: 1 }];
    const snapshot = JSON.stringify(words);
    expect(validateTranscriptWords(words)).toEqual(words);
    expect(JSON.stringify(words)).toBe(snapshot);
  });
});
