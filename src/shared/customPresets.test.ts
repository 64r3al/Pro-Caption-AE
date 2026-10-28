import { describe, expect, it } from "vitest";
import { isValidCustomPreset, parseCustomPresetStorage, serializeCustomPresetStorage } from "./customPresets";
import type { ViralPreset } from "./presets";

const validPreset: ViralPreset = {
  id: "custom-test-1",
  num: 1000,
  name: "My Custom Style",
  category: "Kinetic Motion",
  tag: "CUSTOM",
  whatItLooksLike: "A saved custom style",
  description: "A test preset",
  fontSize: 72,
  wordsPerGroup: 2,
  bounceScale: 20,
  yOffset: -80,
  baseColor: "#FFFFFF",
  highlightColor: "#FFCC00",
  strokeWidth: 4,
  strokeColor: "#000000",
  posIndex: 0,
  reveal: true,
  highlight: true,
  pop: true,
  shadow: false,
  font: "Arial-BoldMT",
  animMode: "motion:slide-up",
  previewBgGradient: "from-surface-container via-surface-container to-transparent",
  accentBadge: "bg-primary text-on-primary",
  previewStyleClass: "preset-anim-center-jump",
};

describe("custom preset storage", () => {
  it("round-trips schema-versioned presets", () => {
    const serialized = serializeCustomPresetStorage([validPreset]);
    expect(parseCustomPresetStorage(serialized)).toEqual([validPreset]);
  });

  it("returns an empty list for malformed, unsupported, or non-array storage", () => {
    expect(parseCustomPresetStorage(null)).toEqual([]);
    expect(parseCustomPresetStorage("{")).toEqual([]);
    expect(parseCustomPresetStorage(JSON.stringify({ schemaVersion: 99, presets: [validPreset] }))).toEqual([]);
    expect(parseCustomPresetStorage(JSON.stringify({ schemaVersion: 1, presets: {} }))).toEqual([]);
  });

  it("filters corrupted entries and rejects invalid colors, ranges, and built-in IDs", () => {
    expect(isValidCustomPreset(validPreset)).toBe(true);
    expect(isValidCustomPreset({ ...validPreset, id: "single-word-center" })).toBe(false);
    expect(isValidCustomPreset({ ...validPreset, baseColor: "url(javascript:alert(1))" })).toBe(false);
    expect(isValidCustomPreset({ ...validPreset, fontSize: 0 })).toBe(false);
    expect(parseCustomPresetStorage(JSON.stringify({
      schemaVersion: 1,
      presets: [validPreset, { ...validPreset, id: "builtin-id" }, null],
    }))).toEqual([validPreset]);
  });

  it("caps the stored collection at 100 presets", () => {
    const presets = Array.from({ length: 105 }, (_value, index) => ({
      ...validPreset,
      id: "custom-" + index,
      num: 1000 + index,
      name: "Custom " + index,
    }));
    expect(parseCustomPresetStorage(serializeCustomPresetStorage(presets))).toHaveLength(100);
  });
});
