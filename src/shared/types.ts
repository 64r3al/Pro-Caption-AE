// Types shared between the CEP panel (src/js) and the ExtendScript host (src/jsx).
// Imported with `import type` on the host side so nothing runtime leaks into ES3 output.

/** Everything the panel needs to know about the layer the user has selected, gathered
 * host-side because only ExtendScript can read the AE project/comp/layer model. */
export interface SelectedAudioLayerInfo {
  compId: number;
  /** Absolute path of the saved project; omitted when the project has not been saved yet. */
  projectFilePath?: string;
  compName: string;
  compWidth: number;
  compHeight: number;
  compFrameRate: number;
  compDuration: number;
  layerIndex: number;
  layerName: string;
  sourceFilePath: string;
  sourceFileName: string;
  sourceFileSizeBytes: number;
  /** Layer's startTime in comp time (seconds); may be negative. */
  startTime: number;
  /** Layer's time-stretch percentage, e.g. 100 = normal speed. */
  stretchPercent: number;
  /** Layer inPoint clamped to >= 0, in comp time (seconds). */
  inPoint: number;
  /** Layer outPoint clamped to <= comp.duration, in comp time (seconds). */
  outPoint: number;
  /** Where inPoint falls inside the *source* media, in source-time seconds. */
  sourceInSeconds: number;
  /** How much of the source media is actually used, in source-time seconds. */
  sourceDurationSeconds: number;
}

/** A single word with start/end timestamps, in seconds relative to whatever clip produced it. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export type GroqModel = "whisper-large-v3" | "whisper-large-v3-turbo";

export interface GroqSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

/** Normalized result of a Groq transcription call (verbose_json), independent of whether
 * word-level timestamps were available (falls back to segments upstream if not). */
export interface TranscriptResult {
  text: string;
  language?: string;
  duration?: number;
  words: TranscriptWord[];
  segments: GroqSegment[];
}

export type ApiKeySource = "settings" | "env" | "none";

export interface ApiKeyStatus {
  source: ApiKeySource;
  /** Last 4 characters only, for display; the real key never round-trips to the UI unnecessarily. */
  last4: string;
}

// --- Phase 2: caption building ------------------------------------------------------------

/** A caption group as the panel computes it (src/shared/captions.ts's CaptionGroup) and hands
 * to the host in one evalTS call. Plain data only — JSON-serializable, since evalTS
 * JSON.stringifies every argument across the panel/ExtendScript boundary. */
export interface CaptionGroupData {
  words: TranscriptWord[];
  start: number;
  end: number;
  text: string;
}

/** 0-3, matching src/shared/constants.ts's POSITION_OPTIONS (Bottom/Lower third/Center/Top). */
export type CaptionPositionIndex = 0 | 1 | 2 | 3;

export type PresetCategory =
  | "TikTok / Reels / Shorts"
  | "YouTube"
  | "AMV / Edits"
  | "Music Videos / Lyric Videos"
  | "Storytelling & Movie"
  | "Kinetic Motion";

/** Style + animation toggles for buildCaptions. Colors are 0xRRGGBB ints (never negative,
 * always JSON-safe) rather than AE's native [0-1,0-1,0-1] float triples, so the panel's color
 * pickers (which work in hex) don't need a round-trip conversion just to cross the bridge. */
export interface CaptionStyle {
  font: string;
  size: number;
  textColor: number;
  highlightColor: number;
  strokeColor: number;
  strokeWidth: number;
  posIndex: CaptionPositionIndex;
  reveal: boolean;
  highlight: boolean;
  pop: boolean;
  shadow: boolean;
  leadInFrames: number;
  animMode?: string;
  rotationDeg?: number;
  trackingAmount?: number;
  /** Extra overshoot for the pop animation, in percent (0 = none). */
  bounceScale?: number;
  /** Vertical nudge in px, relative to a 1920px-tall frame. */
  yOffset?: number;
  /** Entry/emphasis motion (see shared/motion.ts). */
  motion?: string;
  /** Disables all time-varying text effects while preserving caption layer timing. */
  staticAnimation?: boolean;
}

export interface BuildCaptionsResult {
  words: number;
  captions: number;
  precompName: string;
}

/** A font installed on the user's machine, as After Effects reports it. `postScriptName` is
 * what TextDocument.font needs; family/style drive the panel preview and the picker. */
export interface FontInfo {
  postScriptName: string;
  family: string;
  style: string;
}
