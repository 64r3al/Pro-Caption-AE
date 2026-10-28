import { describe, expect, it } from "vitest";
import { compressWaveformSamples } from "./waveform";

describe("compressWaveformSamples", () => {
  it("returns no bars for empty or invalid requests", () => {
    expect(compressWaveformSamples([])).toEqual([]);
    expect(compressWaveformSamples([0.2, 0.3], 0)).toEqual([]);
  });

  it("compresses samples into the requested number of peak bars", () => {
    const samples = Array.from({ length: 100 }, (_value, index) => index === 55 ? 0.9 : 0.1);
    const bars = compressWaveformSamples(samples, 10);
    expect(bars).toHaveLength(10);
    expect(Math.max(...bars)).toBe(90);
    expect(bars.every((height) => height >= 6 && height <= 100)).toBe(true);
  });

  it("limits output size and displays silence with a small baseline", () => {
    expect(compressWaveformSamples(Array(500).fill(0), 500)).toHaveLength(160);
    expect(compressWaveformSamples([0, 0, 0], 3)).toEqual([6, 6, 6]);
  });

  it("ignores non-finite sample values", () => {
    expect(compressWaveformSamples([Number.NaN, Number.POSITIVE_INFINITY, 0])).toEqual([6, 6, 6]);
  });
});
