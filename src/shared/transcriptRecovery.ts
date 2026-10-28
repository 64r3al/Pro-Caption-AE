import type { SelectedAudioLayerInfo, TranscriptWord } from "./types";
import { validateTranscriptWords } from "./transcriptValidation";

export const TRANSCRIPT_RECOVERY_SCHEMA = 1;
export const TRANSCRIPT_RECOVERY_PREFIX = "pro_caption_ae.transcript.v1:";

export interface TranscriptRecoveryRecord {
  schemaVersion: number;
  projectFilePath: string;
  compId: number;
  layerIndex: number;
  sourceFilePath: string;
  compName: string;
  layerName: string;
  language: string;
  edited: boolean;
  updatedAt: number;
  words: TranscriptWord[];
}

/** Normalize separators everywhere and case-fold Windows drive/UNC paths only. */
export const normalizeTranscriptRecoveryPath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/");
  const isWindowsPath = /^[a-z]:\//i.test(normalized) || normalized.startsWith("//");
  return isWindowsPath ? normalized.toLowerCase() : normalized;
};

/** Recovery is scoped to a saved AE project, composition, and selected source layer. */
export const transcriptRecoveryKey = (info: SelectedAudioLayerInfo): string | null => {
  if (!info.projectFilePath || !info.projectFilePath.trim()) return null;
  return TRANSCRIPT_RECOVERY_PREFIX + [
    encodeURIComponent(normalizeTranscriptRecoveryPath(info.projectFilePath)),
    String(info.compId),
    String(info.layerIndex),
  ].join(":");
};

const isValidRecord = (value: unknown): value is TranscriptRecoveryRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<TranscriptRecoveryRecord>;
  if (record.schemaVersion !== TRANSCRIPT_RECOVERY_SCHEMA) return false;
  if (typeof record.projectFilePath !== "string" || !record.projectFilePath) return false;
  if (!Number.isInteger(record.compId) || !Number.isInteger(record.layerIndex)) return false;
  if (typeof record.sourceFilePath !== "string" || !record.sourceFilePath) return false;
  if (typeof record.compName !== "string" || typeof record.layerName !== "string") return false;
  if (typeof record.language !== "string" || typeof record.edited !== "boolean") return false;
  if (!Number.isFinite(record.updatedAt) || !Array.isArray(record.words)) return false;
  if (record.words.length === 0 || record.words.length > 250_000) return false;
  const words = validateTranscriptWords(record.words);
  if (words.length !== record.words.length) return false;
  return true;
};

export const parseTranscriptRecovery = (
  raw: string | null,
  expected: SelectedAudioLayerInfo
): TranscriptRecoveryRecord | null => {
  if (!raw || !transcriptRecoveryKey(expected)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isValidRecord(value)) return null;
    if (value.compId !== expected.compId || value.layerIndex !== expected.layerIndex) return null;
    if (normalizeTranscriptRecoveryPath(value.projectFilePath) !== normalizeTranscriptRecoveryPath(expected.projectFilePath || "")) return null;
    if (normalizeTranscriptRecoveryPath(value.sourceFilePath) !== normalizeTranscriptRecoveryPath(expected.sourceFilePath)) return null;
    return { ...value, words: validateTranscriptWords(value.words) };
  } catch {
    return null;
  }
};

export const serializeTranscriptRecovery = (record: TranscriptRecoveryRecord): string =>
  JSON.stringify({
    ...record,
    schemaVersion: TRANSCRIPT_RECOVERY_SCHEMA,
    words: validateTranscriptWords(record.words),
  });
