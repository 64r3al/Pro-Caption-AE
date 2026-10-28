import type { ViralPreset } from "./presets";
import { isMotionType } from "./motion";

const STORAGE_SCHEMA_VERSION = 1;
const MAX_CUSTOM_PRESETS = 100;
const PRESET_CATEGORIES = [
  "TikTok / Reels / Shorts",
  "YouTube",
  "AMV / Edits",
  "Music Videos / Lyric Videos",
  "Storytelling & Movie",
  "Kinetic Motion",
];

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

/** Strictly validates stored custom preset data before it reaches React styles or the AE bridge. */
export const isValidCustomPreset = (value: unknown): value is ViralPreset => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id.startsWith("custom-")) return false;
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) return false;
  if (!Number.isInteger(value.num) || value.num < 1000) return false;
  if (!PRESET_CATEGORIES.includes(value.category)) return false;
  if (typeof value.tag !== "string" || value.tag.length > 24) return false;
  if (typeof value.whatItLooksLike !== "string" || value.whatItLooksLike.length > 180) return false;
  if (typeof value.description !== "string" || value.description.length > 500) return false;
  if (!Number.isFinite(value.fontSize) || value.fontSize < 8 || value.fontSize > 1000) return false;
  if (![1, 2, 3].includes(value.wordsPerGroup)) return false;
  if (!Number.isFinite(value.bounceScale) || value.bounceScale < 0 || value.bounceScale > 300) return false;
  if (!Number.isFinite(value.yOffset) || Math.abs(value.yOffset) > 4000) return false;
  if (!isColor(value.baseColor) || !isColor(value.highlightColor) || !isColor(value.strokeColor)) return false;
  if (!Number.isFinite(value.strokeWidth) || value.strokeWidth < 0 || value.strokeWidth > 100) return false;
  if (![0, 1, 2, 3].includes(value.posIndex)) return false;
  if (typeof value.reveal !== "boolean" || typeof value.highlight !== "boolean") return false;
  if (typeof value.pop !== "boolean" || typeof value.shadow !== "boolean") return false;
  if (typeof value.font !== "string" || !value.font || value.font.length > 200) return false;
  if (typeof value.animMode !== "string" || value.animMode.length > 80) return false;
  if (value.motionOverride !== undefined && value.motionOverride !== null && !isMotionType(value.motionOverride)) return false;
  if (value.staticAnimation !== undefined && typeof value.staticAnimation !== "boolean") return false;
  if (value.strokeEnabled !== undefined && typeof value.strokeEnabled !== "boolean") return false;
  if (typeof value.previewBgGradient !== "string" || value.previewBgGradient.length > 200) return false;
  if (typeof value.accentBadge !== "string" || value.accentBadge.length > 200) return false;
  if (typeof value.previewStyleClass !== "string" || value.previewStyleClass.length > 200) return false;
  return true;
};

export const parseCustomPresetStorage = (raw: string | null): ViralPreset[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(parsed.presets)) {
      return [];
    }
    const valid = parsed.presets.filter(isValidCustomPreset) as ViralPreset[];
    return valid.slice(-MAX_CUSTOM_PRESETS);
  } catch {
    return [];
  }
};

export const serializeCustomPresetStorage = (presets: readonly ViralPreset[]): string =>
  JSON.stringify({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    presets: presets.filter(isValidCustomPreset).slice(-MAX_CUSTOM_PRESETS),
  });
