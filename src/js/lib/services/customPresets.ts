import { parseCustomPresetStorage, serializeCustomPresetStorage } from "../../../shared/customPresets";
import type { ViralPreset } from "../../../shared/presets";

const STORAGE_KEY = "pro_caption_ae.custom_presets.v1";

export const loadCustomPresets = (): ViralPreset[] => {
  try {
    return parseCustomPresetStorage(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
};

export const persistCustomPresets = (presets: readonly ViralPreset[]): void => {
  const payload = serializeCustomPresetStorage(presets);
  try {
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch (error: any) {
    throw new Error(error?.message || "Could not save custom presets to this extension's local storage.");
  }
};
