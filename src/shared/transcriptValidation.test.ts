import { describe, expect, it } from "vitest";
import { normalizeTranscriptWords, validateTranscriptWords } from "./transcriptValidation";
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


describe("normalizeTranscriptWords", () => {
  it("prefers valid word-level timestamps and trims the source text", () => {
    expect(normalizeTranscriptWords({
      words: [
        { word: " hello ", start: 0.1, end: 0.3 },
        { word: "world", start: 0.4, end: 0.7 },
      ],
      segments: [{ text: "wrong fallback", start: 0, end: 1 }],
    })).toEqual([
      { text: "hello", start: 0.1, end: 0.3 },
      { text: "world", start: 0.4, end: 0.7 },
    ]);
  });

  it("estimates word times from segments only when word-level data has no usable entries", () => {
    expect(normalizeTranscriptWords({
      words: [{ word: "invalid", start: Number.NaN, end: 2 }],
      segments: [
        { text: "one two", start: 2, end: 3 },
        { text: "bad range", start: 5, end: 4 },
        null,
      ],
    })).toEqual([
      { text: "one", start: 2, end: 2.5 },
      { text: "two", start: 2.5, end: 3 },
    ]);
  });

  it("returns an empty list for null and unexpected response shapes", () => {
    expect(normalizeTranscriptWords(null)).toEqual([]);
    expect(normalizeTranscriptWords("not an object")).toEqual([]);
    expect(normalizeTranscriptWords({ words: null, segments: "not segments" })).toEqual([]);
  });

  it("does not use a segment fallback when at least one word-level item is usable", () => {
    expect(normalizeTranscriptWords({
      words: [
        { word: "valid", start: 0, end: 0.2 },
        null,
        { word: "", start: 0.3, end: 0.4 },
      ],
      segments: [{ text: "different text", start: 0, end: 1 }],
    })).toEqual([{ text: "valid", start: 0, end: 0.2 }]);
  });
});
