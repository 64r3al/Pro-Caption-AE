import { extractAudio, findFfmpeg, getFileSizeBytes, removeTempFile } from "./ffmpeg";
import { transcribe, type TranscribeOptions } from "./groq";
import { refineOnsets } from "./onset";
import { planChunks, stitchTranscriptChunks, type TranscribedChunk } from "../../../shared/chunking";
import {
  CHUNK_MAX_SECONDS,
  CHUNK_OVERLAP_SECONDS,
  DEFAULT_SYNC_OPTIONS,
  DIRECT_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from "../../../shared/constants";
import type { SelectedAudioLayerInfo, TranscriptResult, TranscriptWord } from "../../../shared/types";

export type PipelineStage = "extracting" | "transcribing";

export interface Cancellable {
  cancel: () => void;
}

/** A transcription in flight. `cancel()` stops the current ffmpeg/Groq step and removes any
 * temp audio; the promise then rejects with "Cancelled.". */
export interface TranscriptionJob {
  promise: Promise<TranscriptionOutcome>;
  cancel: () => void;
}

export interface TranscriptionOutcome {
  transcript: TranscriptResult;
  /** The single audio file sent to Groq, kept for onset refinement. Null when the clip was
   * transcribed in chunks, since no one file covers it. */
  audioPath: string | null;
  /** Set when `audioPath` is a temp file this job created; the caller owns deleting it. */
  isTempAudio: boolean;
}

const CANCELLED = "Cancelled.";

export const transcribeSelection = (
  info: SelectedAudioLayerInfo,
  opts: TranscribeOptions,
  onStatus: (stage: PipelineStage, text: string) => void
): TranscriptionJob => {
  let cancelled = false;
  let active: Cancellable | null = null;
  let tempPath: string | null = null;

  const dropTemp = () => {
    if (tempPath) removeTempFile(tempPath);
    tempPath = null;
  };
  const checkCancelled = () => {
    if (cancelled) throw new Error(CANCELLED);
  };

  const run = async (): Promise<TranscriptionOutcome> => {
    const ffmpegPath = await findFfmpeg();
    checkCancelled();

    if (ffmpegPath && info.sourceDurationSeconds > CHUNK_MAX_SECONDS) {
      const plan = planChunks(info.sourceDurationSeconds, CHUNK_MAX_SECONDS, CHUNK_OVERLAP_SECONDS);
      const chunks: TranscribedChunk[] = [];
      for (let i = 0; i < plan.length; i++) {
        checkCancelled();
        onStatus("extracting", `Extracting chunk ${i + 1} of ${plan.length}…`);
        const extract = extractAudio(
          ffmpegPath,
          info.sourceFilePath,
          info.sourceInSeconds + plan[i].start,
          plan[i].duration
        );
        active = extract;
        tempPath = extract.outPath;
        const chunkPath = await extract.promise;
        checkCancelled();

        onStatus("transcribing", `Transcribing chunk ${i + 1} of ${plan.length} with Groq (${opts.model})…`);
        const job = transcribe(chunkPath, opts);
        active = job;
        const result = await job.promise;
        dropTemp();
        checkCancelled();
        chunks.push({ words: result.words, offsetSeconds: plan[i].start });
      }
      const words = stitchTranscriptChunks(chunks, CHUNK_OVERLAP_SECONDS);
      return {
        transcript: { text: words.map((w) => w.text).join(" "), words, segments: [] },
        audioPath: null,
        isTempAudio: false,
      };
    }

    let audioPath: string;
    let isTempAudio = false;
    if (ffmpegPath) {
      onStatus("extracting", "Extracting audio with ffmpeg…");
      const extract = extractAudio(ffmpegPath, info.sourceFilePath, info.sourceInSeconds, info.sourceDurationSeconds);
      active = extract;
      tempPath = extract.outPath;
      audioPath = await extract.promise;
      isTempAudio = true;
      checkCancelled();
    } else {
      const ext = info.sourceFileName.split(".").pop()?.toLowerCase() || "";
      const eligible = DIRECT_UPLOAD_EXTENSIONS.includes(ext) && info.sourceFileSizeBytes <= MAX_UPLOAD_BYTES;
      if (!eligible) {
        throw new Error(
          "ffmpeg was not found, and this file can't be sent directly " +
            (DIRECT_UPLOAD_EXTENSIONS.includes(ext)
              ? "(it is larger than 25 MB)."
              : `(.${ext} is not a format Groq accepts directly).`) +
            "\n\nInstall ffmpeg (Windows: winget install ffmpeg / macOS: brew install ffmpeg) " +
            "or locate it in Settings."
        );
      }
      audioPath = info.sourceFilePath;
    }

    if (getFileSizeBytes(audioPath) > MAX_UPLOAD_BYTES) {
      throw new Error(
        "Audio is larger than 25 MB. Install ffmpeg so it can be split into chunks " +
          "automatically, or trim the layer and try again."
      );
    }

    onStatus("transcribing", `Transcribing with Groq (${opts.model})…`);
    const job = transcribe(audioPath, opts);
    active = job;
    const transcript = await job.promise;
    checkCancelled();

    tempPath = null; // ownership of the kept audio passes to the caller
    return { transcript, audioPath, isTempAudio };
  };

  const promise = run()
    .catch((err) => {
      dropTemp();
      throw cancelled ? new Error(CANCELLED) : err;
    })
    .finally(() => {
      active = null;
    });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      active?.cancel();
      active = null;
      dropTemp();
    },
  };
};

/** Nudges word starts onto actual audio onsets. Returns the input unchanged when there's no
 * single audio file for this transcript or ffmpeg isn't available. */
export const refineWordTiming = async (
  words: TranscriptWord[],
  audioPath: string | null
): Promise<TranscriptWord[]> => {
  if (!audioPath) return words;
  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) return words;
  return refineOnsets(ffmpegPath, audioPath, words, {
    windowSeconds: DEFAULT_SYNC_OPTIONS.onsetWindowSeconds,
    thresholdRatio: DEFAULT_SYNC_OPTIONS.onsetThresholdRatio,
  });
};
