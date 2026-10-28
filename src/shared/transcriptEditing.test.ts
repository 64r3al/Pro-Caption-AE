import { describe, expect, it } from "vitest";
import { suggestInsertedWordTiming } from "./transcriptEditing";
import type { TranscriptWord } from "./types";

const word = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end });

describe("suggestInsertedWordTiming", () => {
  it("inserts inside a quiet gap between the previous end and next start", () => {
    expect(suggestInsertedWordTiming([word("one", 0, 0.2), word("two", 1, 1.2)], 1))
      .toEqual({ start: 0.6, end: 0.8 });
  });

  it("uses a short default duration for a word appended at the end", () => {
    expect(suggestInsertedWordTiming([word("one", 0.1, 0.4)], 1))
      .toEqual({ start: 0.4, end: 0.6000000000000001 });
  });

  it("keeps a leading inserted word short rather than spanning all time before the first word", () => {
    expect(suggestInsertedWordTiming([word("first", 12, 12.2)], 0))
      .toEqual({ start: 11.8, end: 12 });
  });

  it("returns a short default interval for an empty transcript", () => {
    expect(suggestInsertedWordTiming([], 0)).toEqual({ start: 0, end: 0.2 });
  });

  it("refuses insertion between out-of-order or invalid surrounding words", () => {
    expect(suggestInsertedWordTiming([word("later", 2, 2.2), word("earlier", 1, 1.2)], 1)).toBeNull();
    expect(suggestInsertedWordTiming([word("bad", Number.NaN, 2)], 1)).toBeNull();
  });

  it("normalizes invalid duration options and clamps the insertion index", () => {
    expect(suggestInsertedWordTiming([], -10, 0)).toEqual({ start: 0, end: 0.2 });
    expect(suggestInsertedWordTiming([], 99, Number.NaN)).toEqual({ start: 0, end: 0.2 });
  });
});
