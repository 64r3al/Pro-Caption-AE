import { describe, expect, it } from "vitest";
import { formatSubtitles } from "./subtitles";
import type { CaptionGroupData } from "./types";

const groups: CaptionGroupData[] = [
  { text: "Hello\nworld", start: 1.25, end: 2.5, words: [] },
  { text: "Next", start: 60, end: 61.2, words: [] },
];

describe("formatSubtitles", () => {
  it("writes SRT numbering, comma-millisecond timestamps, and line breaks", () => {
    expect(formatSubtitles(groups, "srt")).toBe(
      "1\n00:00:01,250 --> 00:00:02,500\nHello\nworld\n\n" +
      "2\n00:01:00,000 --> 00:01:01,200\nNext\n"
    );
  });

  it("writes WebVTT timestamps with a header and dot milliseconds", () => {
    expect(formatSubtitles([groups[0]], "vtt")).toBe(
      "WEBVTT\n\n00:00:01.250 --> 00:00:02.500\nHello\nworld\n"
    );
  });

  it("skips invalid caption groups and returns only the header for empty WebVTT", () => {
    const invalid = [{ text: "bad", start: 4, end: 4, words: [] }] as CaptionGroupData[];
    expect(formatSubtitles(invalid, "srt")).toBe("");
    expect(formatSubtitles([], "vtt")).toBe("WEBVTT\n\n");
  });
});
