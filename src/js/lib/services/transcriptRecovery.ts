import type { SelectedAudioLayerInfo, TranscriptWord } from "../../../shared/types";
import {
  parseTranscriptRecovery,
  serializeTranscriptRecovery,
  transcriptRecoveryKey,
  TRANSCRIPT_RECOVERY_SCHEMA,
} from "../../../shared/transcriptRecovery";

export interface RecoveredTranscript {
  language: string;
  edited: boolean;
  words: TranscriptWord[];
  updatedAt: number;
}

export const loadRecoveredTranscript = (info: SelectedAudioLayerInfo): RecoveredTranscript | null => {
  const key = transcriptRecoveryKey(info);
  if (!key) return null;
  try {
    const record = parseTranscriptRecovery(window.localStorage.getItem(key), info);
    if (!record) return null;
    return {
      language: record.language,
      edited: record.edited,
      words: record.words,
      updatedAt: record.updatedAt,
    };
  } catch {
    return null;
  }
};

export const saveRecoveredTranscript = (
  info: SelectedAudioLayerInfo,
  words: TranscriptWord[],
  language: string,
  edited: boolean
): boolean => {
  const key = transcriptRecoveryKey(info);
  if (!key) return false;
  const payload = serializeTranscriptRecovery({
    schemaVersion: TRANSCRIPT_RECOVERY_SCHEMA,
    projectFilePath: info.projectFilePath || "",
    compId: info.compId,
    layerIndex: info.layerIndex,
    sourceFilePath: info.sourceFilePath,
    compName: info.compName,
    layerName: info.layerName,
    language,
    edited,
    updatedAt: Date.now(),
    words,
  });
  if (payload.length > 1_500_000) {
    throw new Error("This transcript is too large for local recovery. Export it as JSON to keep a backup.");
  }
  try {
    window.localStorage.setItem(key, payload);
    return true;
  } catch (error: any) {
    throw new Error(error?.message || "Could not save transcript recovery data in local storage.");
  }
};
