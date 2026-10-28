import { describe, expect, it } from "vitest";
import type { SelectedAudioLayerInfo } from "./types";
import {
  parseTranscriptRecovery,
  serializeTranscriptRecovery,
  transcriptRecoveryKey,
  type TranscriptRecoveryRecord,
} from "./transcriptRecovery";

const layer: SelectedAudioLayerInfo = {
  compId: 1001,
  projectFilePath: "C:/Projects/short.aep",
  compName: "Main",
  compWidth: 1920,
  compHeight: 1080,
  compFrameRate: 30,
  compDuration: 20,
  layerIndex: 2,
  layerName: "Voice",
  sourceFilePath: "C:/Media/voice.wav",
  sourceFileName: "voice.wav",
  sourceFileSizeBytes: 1000,
  startTime: 0,
  stretchPercent: 100,
  inPoint: 0,
  outPoint: 20,
  sourceInSeconds: 0,
  sourceDurationSeconds: 20,
};

const record: TranscriptRecoveryRecord = {
  schemaVersion: 1,
  projectFilePath: "C:/Projects/short.aep",
  compId: 1001,
  layerIndex: 2,
  sourceFilePath: "C:/Media/voice.wav",
  sourceFileSizeBytes: 1000,
  compName: "Main",
  layerName: "Voice",
  language: "en",
  edited: true,
  updatedAt: 1_800_000_000_000,
  words: [{ text: "Corrected", start: 0.1, end: 0.5 }],
};

describe("transcript recovery", () => {
  it("only creates a recovery key for saved projects", () => {
    expect(transcriptRecoveryKey(layer)).toContain("pro_caption_ae.transcript.v1:");
    expect(transcriptRecoveryKey({ ...layer, projectFilePath: undefined })).toBeNull();
  });

  it("round-trips a valid transcript for the same project, comp, and source layer", () => {
    const restored = parseTranscriptRecovery(serializeTranscriptRecovery(record), layer);
    expect(restored?.words).toEqual(record.words);
    expect(restored?.edited).toBe(true);
    expect(restored?.language).toBe("en");
  });

  it("does not restore data for another project or source file", () => {
    const encoded = serializeTranscriptRecovery(record);
    expect(parseTranscriptRecovery(encoded, { ...layer, projectFilePath: "C:/Projects/other.aep" })).toBeNull();
    expect(parseTranscriptRecovery(encoded, { ...layer, sourceFilePath: "C:/Media/other.wav" })).toBeNull();
  });

  it("does not restore a transcript when media at the same path has changed size", () => {
    const encoded = serializeTranscriptRecovery(record);
    expect(parseTranscriptRecovery(encoded, { ...layer, sourceFileSizeBytes: 1001 })).toBeNull();
  });

  it("continues to read older records without a media size fingerprint", () => {
    const legacy = { ...record } as Partial<TranscriptRecoveryRecord>;
    delete legacy.sourceFileSizeBytes;
    const restored = parseTranscriptRecovery(serializeTranscriptRecovery(legacy as TranscriptRecoveryRecord), layer);
    expect(restored?.words).toEqual(record.words);
  });

  it("normalizes Windows case but keeps case-distinct POSIX paths separate", () => {
    const windowsCase = { ...layer, projectFilePath: "c:/projects/SHORT.aep" };
    expect(transcriptRecoveryKey(windowsCase)).toBe(transcriptRecoveryKey(layer));

    const posixLayer = { ...layer, projectFilePath: "/Volumes/Work/short.aep" };
    const otherCase = { ...posixLayer, projectFilePath: "/Volumes/work/short.aep" };
    expect(transcriptRecoveryKey(otherCase)).not.toBe(transcriptRecoveryKey(posixLayer));
    expect(parseTranscriptRecovery(serializeTranscriptRecovery({ ...record, projectFilePath: posixLayer.projectFilePath }), otherCase)).toBeNull();
  });

  it("rejects malformed and invalid word data", () => {
    expect(parseTranscriptRecovery("{bad", layer)).toBeNull();
    expect(parseTranscriptRecovery(JSON.stringify({ ...record, words: [{ text: "", start: 2, end: 1 }] }), layer)).toBeNull();
  });
});
