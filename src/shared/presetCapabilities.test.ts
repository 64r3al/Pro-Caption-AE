import { describe, expect, it } from "vitest";
import { getPresetRenderSupport } from "./presetCapabilities";
import { VIRAL_PRESETS } from "./presets";

describe("preset render support", () => {
  it("classifies every built-in preset with an actionable support description", () => {
    expect(VIRAL_PRESETS).toHaveLength(66);
    for (const preset of VIRAL_PRESETS) {
      const support = getPresetRenderSupport(preset.animMode);
      expect(support.label, preset.id).not.toBe("");
      expect(support.description, preset.id).toContain("After Effects");
      expect(["native-shape", "native-motion", "text-approximation"]).toContain(support.level);
    }
  });

  it("identifies supported shape treatments", () => {
    expect(getPresetRenderSupport("sticker").level).toBe("native-shape");
    expect(getPresetRenderSupport("underline").level).toBe("native-shape");
  });

  it("identifies kinetic motion presets and warns for special effects not yet reproduced", () => {
    expect(getPresetRenderSupport("motion:slide-up").level).toBe("native-motion");
    expect(getPresetRenderSupport("rainbow").level).toBe("text-approximation");
    expect(getPresetRenderSupport("pixel-sort").level).toBe("text-approximation");
  });
});
