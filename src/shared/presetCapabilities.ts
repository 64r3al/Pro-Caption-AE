export type PresetRenderSupportLevel = "native-shape" | "native-motion" | "text-approximation";

export interface PresetRenderSupport {
  level: PresetRenderSupportLevel;
  label: string;
  description: string;
}

const NATIVE_SHAPE_MODES = new Set([
  "underline",
  "marker",
  "sticker",
  "sticky-note",
  "blur-box",
  "terminal",
  "search-bar",
  "reddit",
  "tweet",
  "quote",
  "stat-card",
  "newspaper",
  "callout",
  "timeline",
  "chapter",
  "stamp",
  "diary",
  "collage",
  "hologram",
]);

const NATIVE_TEXT_MODES = new Set([
  "single-word",
  "rotate",
  "stroke-fill",
  "squash",
  "shadow-pop",
  "wave",
  "zoom-punch",
]);

/**
 * Describes what the current ExtendScript builder can honestly promise.
 * A native shape label means editable text plus a basic shape treatment, not reproduction of
 * every illustrative icon or browser-only interface element shown in a preset's panel preview.
 */
export const getPresetRenderSupport = (animMode: string): PresetRenderSupport => {
  if (NATIVE_SHAPE_MODES.has(animMode)) {
    return {
      level: "native-shape",
      label: "Native text + shape",
      description: "Builds editable After Effects text and a native shape treatment. Illustrative UI chrome and advanced effects in the panel preview may be simplified.",
    };
  }

  if (NATIVE_TEXT_MODES.has(animMode) || animMode.indexOf("motion:") === 0) {
    return {
      level: "native-motion",
      label: "Native text motion",
      description: "Builds editable After Effects text using native text animators and the selected motion. The panel preview is representative, not a pixel-identical render.",
    };
  }

  return {
    level: "text-approximation",
    label: "Text approximation",
    description: "Uses editable text, available text effects, and the closest supported motion. The preset's special visual effects are not fully reproduced in After Effects yet.",
  };
};
