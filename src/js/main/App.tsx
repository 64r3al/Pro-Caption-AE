import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { evalTS } from "../lib/utils/bolt";
import { resolveApiKey } from "../lib/services/apiKey";
import { extractWaveformPeaks, findFfmpeg, removeTempFile } from "../lib/services/ffmpeg";
import { refineWordTiming, transcribeSelection, type TranscriptionJob } from "../lib/services/pipeline";
import { SettingsTab } from "./components/SettingsTab";
import { ToastProvider, useToast } from "./ui/Toast";
import { hexToInt, intToHex } from "./ui/color";
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_GROUPING_OPTIONS,
  DEFAULT_SYNC_OPTIONS,
  MODEL_OPTIONS,
  LANGUAGE_OPTIONS,
  VOCAB_MAX_TOKENS,
} from "../../shared/constants";
import type {
  BuildCaptionsResult,
  CaptionGroupData,
  CaptionPositionIndex,
  CaptionStyle,
  GroqModel,
  SelectedAudioLayerInfo,
  TranscriptWord,
} from "../../shared/types";
import { VIRAL_PRESETS, type ViralPreset } from "../../shared/presets";
import { MOTION_OPTIONS, isMotionType, motionForAnimMode, type MotionType } from "../../shared/motion";
import { cssFontFor } from "../../shared/fonts";
import {
  getCachedFonts,
  getSavedFontOverride,
  loadInstalledFonts,
  saveFontOverride,
  type FontList,
} from "../lib/services/fonts";
import { FontPicker } from "./features/FontPicker";
import { PresetLibraryModal } from "./features/PresetLibraryModal";
import { TranscriptEditor } from "./features/TranscriptEditor";
import { writeExportFile } from "../lib/services/export";
import { loadCustomPresets, persistCustomPresets } from "../lib/services/customPresets";
import { loadRecoveredTranscript, saveRecoveredTranscript } from "../lib/services/transcriptRecovery";
import { syncWords } from "../../shared/sync";
import { buildGroups } from "../../shared/captions";
import { formatSubtitles, type SubtitleFormat } from "../../shared/subtitles";
import { getPresetRenderSupport } from "../../shared/presetCapabilities";
import { isArabicLanguage } from "../../shared/languages";
import { displayName, version } from "../../shared/shared";
import "./app.scss";

type Tab = "transcribe" | "style" | "settings";
type AspectRatio = "9:16" | "16:9" | "1:1";

const SAMPLE_TRANSCRIPT: TranscriptWord[] = [
  { text: "CREATE", start: 0.1, end: 0.55 },
  { text: "VIRAL", start: 0.6, end: 1.15 },
  { text: "CAPTIONS", start: 1.2, end: 1.7 },
  { text: "IN", start: 1.75, end: 1.95 },
  { text: "SECONDS", start: 2.0, end: 2.6 },
];

export const AppContent = () => {
  const { show: showToast } = useToast();
  const [currentTab, setCurrentTab] = useState<Tab>("transcribe");
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [customPresets, setCustomPresets] = useState<ViralPreset[]>(() => loadCustomPresets());
  const availablePresets = useMemo(() => [...VIRAL_PRESETS, ...customPresets], [customPresets]);

  // Selection info
  const [selection, setSelection] = useState<SelectedAudioLayerInfo | null>(null);
  const [loadingSelection, setLoadingSelection] = useState(false);

  // Groq Speech Engine Settings
  const [model, setModel] = useState<GroqModel>("whisper-large-v3-turbo");
  const [language, setLanguage] = useState("");
  const [transcriptLanguage, setTranscriptLanguage] = useState("");
  const [glossary, setGlossary] = useState<string[]>([]);
  const [newGlossaryTag, setNewGlossaryTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);

  // Audio / Transcribe state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState("Select an audio layer, then transcribe.");
  // Sample words drive the live preview until a real transcript exists; hasTranscript gates Build
  // so the sample is never built into the user's comp.
  const [activeWords, setActiveWords] = useState<TranscriptWord[]>(SAMPLE_TRANSCRIPT);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [isTranscriptEdited, setIsTranscriptEdited] = useState(false);
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const [transcriptRecoveryNotice, setTranscriptRecoveryNotice] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const jobRef = useRef<TranscriptionJob | null>(null);
  // Audio the current transcript came from, kept for onset refinement at build time.
  const transcriptAudio = useRef<{ path: string | null; isTemp: boolean }>({ path: null, isTemp: false });
  // The layer the current transcript belongs to; Build maps timing against this, not whatever
  // happens to be selected later.
  const transcribedLayer = useRef<SelectedAudioLayerInfo | null>(null);

  // Waveform state
  const [scrubberPos, setScrubberPos] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [waveformHeights, setWaveformHeights] = useState<number[] | null>(null);
  const [waveformStatus, setWaveformStatus] = useState("Select an audio layer to analyze its waveform.");
  const previewInfo = hasTranscript && transcribedLayer.current ? transcribedLayer.current : selection;
  const fallbackPreviewDuration = 42.5;
  const previewDuration =
    previewInfo?.compDuration && previewInfo.compDuration > 0 ? previewInfo.compDuration : fallbackPreviewDuration;
  const previewFps =
    previewInfo?.compFrameRate && previewInfo.compFrameRate > 0 ? previewInfo.compFrameRate : 30;
  const waveformInfo = hasTranscript && transcribedLayer.current ? transcribedLayer.current : selection;
  const waveformClipLeft = waveformInfo && previewDuration > 0
    ? Math.max(0, Math.min(100, (waveformInfo.inPoint / previewDuration) * 100))
    : 0;
  const waveformClipWidth = waveformInfo && previewDuration > 0
    ? Math.max(0, Math.min(100 - waveformClipLeft, ((waveformInfo.outPoint - waveformInfo.inPoint) / previewDuration) * 100))
    : 100;
  const totalFrames = Math.max(1, Math.round(previewDuration * previewFps));

  // Live Preview Canvas state
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");

  // Animation Preset state
  const [selectedPresetId, setSelectedPresetId] = useState<string>("single-word-center");

  // Kinetic Inspector Props
  const [fontSize, setFontSize] = useState(78);
  const [wordsPerGroup, setWordsPerGroup] = useState<1 | 2 | 3>(2);
  const [bounceScale, setBounceScale] = useState(28);
  const [yOffset, setYOffset] = useState(-120);
  const [baseColor, setBaseColor] = useState("#FFFFFF");
  const [highlightColor, setHighlightColor] = useState("#D0BCFF");
  const [autoSnapOnsets, setAutoSnapOnsets] = useState(true);
  const [splitOnPauses, setSplitOnPauses] = useState(true);

  // Library search / filter state for in-tab browsing
  const [libraryFilter, setLibraryFilter] = useState("All");
  const [librarySearch, setLibrarySearch] = useState("");

  // Building in AE state
  const [isBuilding, setIsBuilding] = useState(false);

  // Current active preset object
  const currentPreset = availablePresets.find((p) => p.id === selectedPresetId) || VIRAL_PRESETS[0];

  // null = use the preset's own motion. Kinetic Motion presets and any override preview the
  // exact motion After Effects will build; classic presets keep their bespoke preview looks.
  const [motionOverride, setMotionOverride] = useState<MotionType | null>(null);
  const [staticAnimation, setStaticAnimation] = useState(false);
  const effectiveMotion: MotionType = motionOverride ?? motionForAnimMode(currentPreset.animMode);
  const isStaticAnimation = staticAnimation;
  const [strokeEnabled, setStrokeEnabled] = useState(currentPreset.strokeWidth > 0);
  const hasPresetStroke = currentPreset.strokeWidth > 0;
  const isStrokeEnabled = hasPresetStroke && strokeEnabled;
  const effectiveStrokeWidth = isStrokeEnabled ? currentPreset.strokeWidth : 0;
  // Font: null = the preset's font. The choice sticks across presets and panel reloads.
  const [fontOverride, setFontOverride] = useState<string | null>(() => getSavedFontOverride());
  const [fontList, setFontList] = useState<FontList | null>(() => getCachedFonts());
  const [fontsLoading, setFontsLoading] = useState(false);
  const fontsRequested = useRef(false);
  const effectiveFont = fontOverride ?? (currentPreset.font || DEFAULT_CAPTION_STYLE.font);
  const previewFont = cssFontFor(effectiveFont, fontList?.fonts ?? []);

  const refreshFonts = async () => {
    fontsRequested.current = true;
    setFontsLoading(true);
    try {
      setFontList(await loadInstalledFonts());
    } finally {
      setFontsLoading(false);
    }
  };
  const ensureFonts = () => {
    if (!fontsRequested.current) refreshFonts();
  };
  const chooseFont = (postScriptName: string | null) => {
    setFontOverride(postScriptName);
    saveFontOverride(postScriptName);
  };

  const previewMotionClass = isStaticAnimation
    ? null
    : motionOverride || currentPreset.animMode.startsWith("motion:")
    ? `live-motion-${effectiveMotion}`
    : null;

  const refreshSelection = async (): Promise<SelectedAudioLayerInfo | null> => {
    setLoadingSelection(true);
    try {
      const info = await evalTS("getSelectedAudioLayerInfo");
      setSelection(info);
      setSelectionError(null);
      const recovered = loadRecoveredTranscript(info);
      if (recovered) {
        const previousLayer = transcribedLayer.current;
        const isSameSource = !!previousLayer && previousLayer.compId === info.compId &&
          previousLayer.layerIndex === info.layerIndex &&
          previousLayer.sourceFilePath.replace(/\\/g, "/") === info.sourceFilePath.replace(/\\/g, "/") &&
          previousLayer.projectFilePath?.replace(/\\/g, "/") === info.projectFilePath?.replace(/\\/g, "/");
        if (!isSameSource) {
          if (transcriptAudio.current.path && transcriptAudio.current.isTemp) {
            removeTempFile(transcriptAudio.current.path);
          }
          transcriptAudio.current = { path: null, isTemp: false };
        }
        transcribedLayer.current = info;
        setActiveWords(recovered.words);
        setTranscriptLanguage(recovered.language);
        setIsTranscriptEdited(recovered.edited);
        setHasTranscript(true);
        setTranscriptRevision((revision) => revision + 1);
        setActiveWordIndex(0);
        setScrubberPos(0);
        setTranscriptRecoveryNotice(
          `Recovered ${recovered.words.length} words saved ${new Date(recovered.updatedAt).toLocaleString()}.`
        );
      }
      return info;
    } catch (err: any) {
      setSelection(null);
      setSelectionError(err?.message || String(err));
      return null;
    } finally {
      setLoadingSelection(false);
    }
  };

  const releaseTranscriptAudio = () => {
    const { path, isTemp } = transcriptAudio.current;
    if (path && isTemp) removeTempFile(path);
    transcriptAudio.current = { path: null, isTemp: false };
  };

  useEffect(() => {
    refreshSelection();
    return () => {
      jobRef.current?.cancel();
      releaseTranscriptAudio();
    };
  }, []);

  // The playhead advances in real time. When a transcript exists, its active word follows
  // the selected layer's actual source-to-composition time mapping.
  useEffect(() => {
    if (!isPlaying || previewDuration <= 0) return;
    const intervalMs = 100;
    const increment = (intervalMs * playbackSpeed * 100) / (1000 * previewDuration);
    const interval = window.setInterval(() => {
      setScrubberPos((previous) => {
        const next = previous + increment;
        return next >= 100 ? 0 : next;
      });
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [isPlaying, playbackSpeed, previewDuration]);

  // Keep the sample preview lively before the first transcription; real transcripts are
  // instead driven by the playhead timing below.
  useEffect(() => {
    if (!isPlaying || hasTranscript || !activeWords.length) return;
    const interval = window.setInterval(() => {
      setActiveWordIndex((previous) => (previous + 1) % activeWords.length);
    }, Math.round(520 / playbackSpeed));
    return () => window.clearInterval(interval);
  }, [isPlaying, hasTranscript, activeWords.length, playbackSpeed]);

  useEffect(() => {
    const currentTime = (scrubberPos / 100) * previewDuration;
    if (hasTranscript && activeWords.length) {
      const info = transcribedLayer.current;
      let bestIndex = 0;
      for (let index = 0; index < activeWords.length; index++) {
        const word = activeWords[index];
        const start = info
          ? info.startTime + (info.sourceInSeconds + word.start) * (info.stretchPercent / 100)
          : word.start;
        if (start <= currentTime) bestIndex = index;
        else break;
      }
      setActiveWordIndex(bestIndex);
    }
    setCurrentFrame(Math.max(1, Math.min(totalFrames, Math.floor(currentTime * previewFps) + 1)));
  }, [scrubberPos, activeWords, hasTranscript, previewDuration, previewFps, totalFrames]);

  useEffect(() => {
    const info = hasTranscript && transcribedLayer.current ? transcribedLayer.current : selection;
    if (!info) {
      setWaveformHeights(null);
      setWaveformStatus("Select an audio layer to analyze its waveform.");
      return;
    }

    let cancelled = false;
    const loadWaveform = async () => {
      setWaveformHeights(null);
      setWaveformStatus("Analyzing audio waveform…");
      try {
        const ffmpegPath = findFfmpeg();
        if (!ffmpegPath) {
          setWaveformStatus("FFmpeg is required to analyze the real waveform.");
          return;
        }
        const heights = await extractWaveformPeaks(
          ffmpegPath,
          info.sourceFilePath,
          info.sourceInSeconds,
          info.sourceDurationSeconds,
          64
        );
        if (cancelled) return;
        setWaveformHeights(heights);
        setWaveformStatus("Audio waveform ready.");
      } catch (err: any) {
        if (cancelled) return;
        setWaveformHeights(null);
        setWaveformStatus(err?.message || "Could not analyze this source's audio waveform.");
      }
    };
    void loadWaveform();
    return () => {
      cancelled = true;
    };
  }, [
    selection?.sourceFilePath,
    selection?.sourceInSeconds,
    selection?.sourceDurationSeconds,
    hasTranscript,
  ]);

  // Handle Preset selection
  const applyPreset = (preset: ViralPreset) => {
    setSelectedPresetId(preset.id);
    setMotionOverride(preset.motionOverride && isMotionType(preset.motionOverride) ? preset.motionOverride : null);
    setStaticAnimation(preset.staticAnimation ?? false);
    setStrokeEnabled(preset.strokeWidth > 0 && (preset.strokeEnabled ?? true));
    if (preset.id.startsWith("custom-")) {
      setFontOverride(preset.font);
      saveFontOverride(preset.font);
    }
    setFontSize(preset.fontSize);
    setWordsPerGroup(preset.wordsPerGroup);
    setBounceScale(preset.bounceScale);
    setYOffset(preset.yOffset);
    setBaseColor(preset.baseColor);
    setHighlightColor(preset.highlightColor);

    showToast({
      title: `${preset.name} Preset Applied`,
      description: `${preset.wordsPerGroup} words/group • ${preset.bounceScale}% bounce • ${preset.tag}`,
      variant: "success",
    });
  };

  const handleSelectPresetById = (id: string) => {
    const p = availablePresets.find((item) => item.id === id);
    if (p) applyPreset(p);
  };

  const handleSaveCustomPreset = () => {
    if (customPresets.length >= 100) {
      showToast({
        title: "Custom preset limit reached",
        description: "This release supports up to 100 saved custom presets. Delete one before saving another.",
        variant: "error",
      });
      return;
    }

    const enteredName = window.prompt("Name this custom preset", currentPreset.name + " Custom");
    if (enteredName === null) return;
    const name = enteredName.replace(/^\s+|\s+$/g, "").slice(0, 80);
    if (!name) {
      showToast({ title: "Preset name required", description: "Enter a name before saving.", variant: "error" });
      return;
    }

    const id = "custom-" + Date.now().toString(36);
    const preset: ViralPreset = {
      ...currentPreset,
      id,
      num: 1000 + customPresets.length,
      name,
      category: "Kinetic Motion",
      tag: "CUSTOM",
      whatItLooksLike: "Saved custom typography and animation settings",
      description: "Custom preset saved locally with its font, colours, grouping, and animation choices.",
      fontSize,
      wordsPerGroup,
      bounceScale,
      yOffset,
      baseColor,
      highlightColor,
      strokeWidth: currentPreset.strokeWidth ?? 0,
      strokeEnabled: isStrokeEnabled,
      staticAnimation,
      strokeColor: currentPreset.strokeColor || "#000000",
      posIndex: currentPreset.posIndex,
      reveal: currentPreset.reveal ?? true,
      highlight: currentPreset.highlight ?? true,
      pop: bounceScale > 0,
      shadow: currentPreset.shadow ?? true,
      font: effectiveFont,
      animMode: currentPreset.animMode,
      motionOverride,
      previewBgGradient: "from-surface-container via-surface-container to-transparent",
      accentBadge: "bg-primary text-on-primary",
      previewStyleClass: currentPreset.previewStyleClass || "preset-anim-center-jump",
    };

    const nextPresets = [...customPresets, preset];
    try {
      persistCustomPresets(nextPresets);
      setCustomPresets(nextPresets);
      setSelectedPresetId(id);
      setFontOverride(effectiveFont);
      saveFontOverride(effectiveFont);
      showToast({
        title: "Custom preset saved",
        description: `"${name}" is saved on this machine and is available in the preset library.`,
        variant: "success",
      });
    } catch (error: any) {
      showToast({
        title: "Could not save preset",
        description: error?.message || "Local preset storage is unavailable.",
        variant: "error",
      });
    }
  };

  const handleDeleteCustomPreset = (id: string) => {
    const preset = customPresets.find((item) => item.id === id);
    if (!preset) return;
    if (!window.confirm(`Delete the custom preset "${preset.name}"? This cannot be undone.`)) return;

    const nextPresets = customPresets.filter((item) => item.id !== id);
    try {
      persistCustomPresets(nextPresets);
      setCustomPresets(nextPresets);
      if (selectedPresetId === id) applyPreset(VIRAL_PRESETS[0]);
      showToast({
        title: "Custom preset deleted",
        description: `"${preset.name}" was removed from this machine.`,
        variant: "success",
      });
    } catch (error: any) {
      showToast({
        title: "Could not delete preset",
        description: error?.message || "Local preset storage is unavailable.",
        variant: "error",
      });
    }
  };

  // Add tag to Glossary
  const handleAddGlossaryTag = () => {
    if (newGlossaryTag.trim() && !glossary.includes(newGlossaryTag.trim())) {
      setGlossary([...glossary, newGlossaryTag.trim()]);
      setNewGlossaryTag("");
      setIsAddingTag(false);
    }
  };

  const removeGlossaryTag = (tag: string) => {
    setGlossary(glossary.filter((t) => t !== tag));
  };

  const handleCancelTranscribe = () => {
    jobRef.current?.cancel();
  };

  const handleTranscribe = async () => {
    const info = await refreshSelection();
    if (!info) {
      showToast({
        title: "No audio layer selected",
        description: "Select an audio or video layer with audio in the active comp.",
        variant: "error",
      });
      return;
    }

    let apiKey: string | null;
    try {
      apiKey = resolveApiKey().key;
    } catch (err: any) {
      showToast({ title: "Can't read settings", description: err?.message || String(err), variant: "error" });
      return;
    }
    if (!apiKey) {
      showToast({
        title: "API Key Required",
        description: "Add your Groq API key in Settings first.",
        variant: "error",
      });
      setCurrentTab("settings");
      return;
    }

    const prompt = glossary.join(", ");
    if (prompt.split(/\s+/).filter(Boolean).length > VOCAB_MAX_TOKENS) {
      showToast({
        title: "Glossary too long",
        description: `Keep the glossary under ~${VOCAB_MAX_TOKENS} words.`,
        variant: "error",
      });
      return;
    }

    setIsTranscribing(true);
    const job = transcribeSelection(
      info,
      { apiKey, model, language: language || undefined, prompt: prompt || undefined },
      (_stage, text) => setTranscribeStatus(text)
    );
    jobRef.current = job;
    try {
      const { transcript, audioPath, isTempAudio } = await job.promise;
      if (!transcript.words.length) {
        if (audioPath && isTempAudio) removeTempFile(audioPath);
        throw new Error("Groq returned no words for this audio.");
      }

      const previousAudio = transcriptAudio.current;
      if (previousAudio.path && previousAudio.isTemp && previousAudio.path !== audioPath) {
        removeTempFile(previousAudio.path);
      }
      transcriptAudio.current = { path: audioPath, isTemp: isTempAudio };
      transcribedLayer.current = info;
      setActiveWords(transcript.words);
      setTranscriptLanguage(transcript.language || "");
      setTranscriptRevision((revision) => revision + 1);
      setActiveWordIndex(0);
      setScrubberPos(0);
      setHasTranscript(true);
      setIsTranscriptEdited(false);
      try {
        const saved = saveRecoveredTranscript(info, transcript.words, transcript.language || "", false);
        setTranscriptRecoveryNotice(
          saved
            ? "Transcript is saved locally and will be restored for this project and layer."
            : "Save the After Effects project to enable local transcript recovery."
        );
      } catch (recoveryError: any) {
        setTranscriptRecoveryNotice("Local recovery could not be saved. Export the transcript as JSON to keep a backup.");
      }
      setTranscribeStatus(`Done: ${transcript.words.length} words.`);
      showToast({
        title: "Transcription Complete",
        description: `${transcript.words.length} words with word-level timestamps.`,
        variant: "success",
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      setTranscribeStatus(message === "Cancelled." ? "Cancelled." : "Transcription failed.");
      if (message !== "Cancelled.") {
        showToast({ title: "Transcription Failed", description: message, variant: "error" });
      }
    } finally {
      jobRef.current = null;
      setIsTranscribing(false);
    }
  };

  const handleBuildInAe = async () => {
    const info = transcribedLayer.current;
    if (!hasTranscript || !info) {
      showToast({
        title: "Nothing to build yet",
        description: "Transcribe an audio layer first.",
        variant: "error",
      });
      return;
    }

    setIsBuilding(true);
    try {
      // Manual timing corrections are authoritative. Automatic onset refinement is applied only
      // to untouched transcription results, never over the user's edits.
      const words = autoSnapOnsets && !isTranscriptEdited
        ? await refineWordTiming(activeWords, transcriptAudio.current.path)
        : activeWords;

      const synced = syncWords(
        words,
        {
          mapping: {
            startTime: info.startTime,
            sourceOffset: info.sourceInSeconds,
            stretchPercent: info.stretchPercent,
          },
          inPoint: info.inPoint,
          outPoint: info.outPoint,
        },
        { fps: info.compFrameRate, offsetFrames: DEFAULT_SYNC_OPTIONS.offsetFrames }
      );

      const groups: CaptionGroupData[] = buildGroups(synced, {
        maxWords: wordsPerGroup,
        maxCharsPerLine: DEFAULT_GROUPING_OPTIONS.maxCharsPerLine,
        maxLines: DEFAULT_GROUPING_OPTIONS.maxLines,
        pauseBreakSeconds: splitOnPauses ? DEFAULT_GROUPING_OPTIONS.pauseBreakSeconds : 999,
        holdSeconds: DEFAULT_GROUPING_OPTIONS.holdSeconds,
        flickerGapSeconds: DEFAULT_GROUPING_OPTIONS.flickerGapSeconds,
        fps: info.compFrameRate,
        compDuration: info.compDuration,
        uppercase: !isArabicLanguage(language || transcriptLanguage),
      });
      if (!groups.length) throw new Error("No words fall inside the layer's in/out range.");

      const style: CaptionStyle = {
        font: effectiveFont,
        size: fontSize,
        textColor: hexToInt(baseColor) ?? DEFAULT_CAPTION_STYLE.textColor,
        highlightColor: hexToInt(highlightColor) ?? DEFAULT_CAPTION_STYLE.highlightColor,
        strokeColor: hexToInt(currentPreset.strokeColor) ?? DEFAULT_CAPTION_STYLE.strokeColor,
        strokeWidth: effectiveStrokeWidth,
        posIndex: (currentPreset.posIndex ?? DEFAULT_CAPTION_STYLE.posIndex) as CaptionPositionIndex,
        reveal: !isStaticAnimation && (currentPreset.reveal ?? true),
        highlight: !isStaticAnimation && (currentPreset.highlight ?? true),
        pop: !isStaticAnimation && bounceScale > 0,
        bounceScale,
        yOffset,
        motion: effectiveMotion,
        staticAnimation: isStaticAnimation,
        shadow: currentPreset.shadow ?? true,
        leadInFrames: DEFAULT_SYNC_OPTIONS.leadInFrames,
        animMode: currentPreset.animMode,
      };

      const result = (await evalTS("buildCaptions", info.compId, groups, style)) as BuildCaptionsResult;
      showToast({
        title: "Built in After Effects",
        description: `${result.captions} captions, ${result.words} words, in "${result.precompName}".${isTranscriptEdited && autoSnapOnsets ? " Manual edits were preserved; auto-snap was skipped." : ""}`,
        variant: "success",
      });
    } catch (err: any) {
      showToast({ title: "Build Failed", description: err?.message || String(err), variant: "error" });
    } finally {
      setIsBuilding(false);
    }
  };

  // Display elapsed time against the selected composition duration.
  const formatTimelineSeconds = (seconds: number): string => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = (safe % 60).toFixed(1).padStart(4, "0");
    return `${String(minutes).padStart(2, "0")}:${remainder}`;
  };
  const timecodeDisplay = `${formatTimelineSeconds((scrubberPos / 100) * previewDuration)} / ${formatTimelineSeconds(previewDuration)}`;

  // Filtered presets for in-tab library
  const tabFilteredPresets = availablePresets.filter((p) => {
    const matchesCat = libraryFilter === "All" || p.category === libraryFilter;
    const matchesSearch =
      librarySearch.trim() === "" ||
      p.name.toLowerCase().includes(librarySearch.toLowerCase()) ||
      p.tag.toLowerCase().includes(librarySearch.toLowerCase()) ||
      p.description.toLowerCase().includes(librarySearch.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const seekToWord = (requestedIndex: number) => {
    if (!activeWords.length) return;
    const index = Math.max(0, Math.min(activeWords.length - 1, requestedIndex));
    const word = activeWords[index];
    setActiveWordIndex(index);
    setIsPlaying(false);
    const info = transcribedLayer.current;
    const targetTime = info
      ? info.startTime + (info.sourceInSeconds + word.start) * (info.stretchPercent / 100)
      : word.start;
    const duration = info?.compDuration && info.compDuration > 0 ? info.compDuration : previewDuration;
    setScrubberPos(Math.max(0, Math.min(100, (targetTime / duration) * 100)));
  };

  const handleExport = async (format: "srt" | "vtt" | "json") => {
    const info = transcribedLayer.current;
    if (!hasTranscript || !info) {
      showToast({
        title: "Nothing to export",
        description: "Transcribe a layer first so the export has a source and valid timing.",
        variant: "error",
      });
      return;
    }
    try {
      let contents: string;
      if (format === "json") {
        contents = JSON.stringify({
          formatVersion: 1,
          sourceLayer: info.layerName,
          composition: info.compName,
          language: language || transcriptLanguage || "auto",
          timebase: "audio-relative-seconds",
          words: activeWords,
        }, null, 2) + "\n";
      } else {
        const synced = syncWords(
          activeWords,
          {
            mapping: {
              startTime: info.startTime,
              sourceOffset: info.sourceInSeconds,
              stretchPercent: info.stretchPercent,
            },
            inPoint: info.inPoint,
            outPoint: info.outPoint,
          },
          { fps: info.compFrameRate, offsetFrames: 0 }
        );
        const groups = buildGroups(synced, {
          maxWords: wordsPerGroup,
          maxCharsPerLine: DEFAULT_GROUPING_OPTIONS.maxCharsPerLine,
          maxLines: DEFAULT_GROUPING_OPTIONS.maxLines,
          pauseBreakSeconds: splitOnPauses ? DEFAULT_GROUPING_OPTIONS.pauseBreakSeconds : 999,
          holdSeconds: DEFAULT_GROUPING_OPTIONS.holdSeconds,
          flickerGapSeconds: DEFAULT_GROUPING_OPTIONS.flickerGapSeconds,
          fps: info.compFrameRate,
          compDuration: info.compDuration,
          uppercase: false,
        });
        contents = formatSubtitles(groups, format as SubtitleFormat);
      }

      const destination = await evalTS("pickExportPath", format);
      if (!destination) return;
      writeExportFile(destination, contents);
      showToast({
        title: "Export complete",
        description: `Saved ${format.toUpperCase()} to ${destination}`,
        variant: "success",
      });
    } catch (err: any) {
      showToast({
        title: "Export failed",
        description: err?.message || String(err),
        variant: "error",
      });
    }
  };

  return (
    <div className="bg-surface text-on-surface flex flex-col min-h-screen selection:bg-primary selection:text-on-primary">
      {/* FIXED TOP HEADER */}
      <header className="fixed top-0 w-full z-40 bg-surface/90 backdrop-blur-xl pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.4)]">
        <div className="h-28 px-margin flex flex-col justify-between py-space-sm">
          {/* Top row: Wordmark, Status, Settings icon, User avatar */}
          <div className="flex items-center justify-between gap-space-sm">
            <div className="flex items-center gap-space-sm min-w-0">
              <div className="w-6 h-6 rounded bg-primary-container/20 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary text-[18px]">graphic_eq</span>
              </div>
              <div className="flex items-center gap-space-xs truncate">
                <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold truncate">
                  {displayName}
                </span>
                <span className="px-space-xs py-[1px] rounded bg-surface-container-high text-primary font-label-xs text-label-xs shrink-0">
                  v{version}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-space-xs shrink-0">
              <button
                onClick={() => setCurrentTab(currentTab === "settings" ? "transcribe" : "settings")}
                className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                  currentTab === "settings"
                    ? "text-primary bg-surface-container-high"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                aria-label="Settings"
                title="Settings"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </button>
            </div>
          </div>

          {/* Layer status bar */}
          <div className="flex items-center justify-between gap-space-sm bg-surface-container-lowest px-space-sm py-space-xs rounded min-h-[24px]">
            <div className="flex items-center gap-space-xs min-w-0">
              <span className="material-symbols-outlined text-primary text-[14px] shrink-0">mic</span>
              <span className="font-label-xs text-label-xs text-on-surface truncate">
                {selection?.layerName || selectionError || "No audio layer selected"}
              </span>
            </div>
            <button
              onClick={() => refreshSelection()}
              title="Refresh selection"
              className="font-label-xs text-label-xs text-on-surface-variant shrink-0 flex items-center gap-space-xs hover:text-on-surface"
            >
              {selection ? `${selection.compName} • ${selection.sourceDurationSeconds.toFixed(1)}s` : "Refresh"}
              <span className={`material-symbols-outlined text-[12px] ${loadingSelection ? "animate-spin" : ""}`}>sync</span>
            </button>
          </div>

          {/* Segmented Navigation Bar */}
          <nav className="flex items-center p-space-xs rounded bg-surface-container-lowest gap-space-xs">
            <button
              onClick={() => setCurrentTab("transcribe")}
              className={`flex-1 h-7 flex items-center justify-center px-space-sm rounded transition-all gap-space-xs ${
                currentTab === "transcribe"
                  ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs"
                  : "font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">subtitles</span>
              <span>Transcribe</span>
            </button>
            <button
              onClick={() => setCurrentTab("style")}
              className={`flex-1 h-7 flex items-center justify-center px-space-sm rounded transition-all gap-space-xs ${
                currentTab === "style"
                  ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs"
                  : "font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">auto_awesome_motion</span>
              <span>Style &amp; Animation</span>
            </button>
            <button
              onClick={() => setCurrentTab("settings")}
              className={`flex-1 h-7 flex items-center justify-center px-space-sm rounded transition-all gap-space-xs ${
                currentTab === "settings"
                  ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs"
                  : "font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">tune</span>
              <span>Settings</span>
            </button>
          </nav>
        </div>
      </header>

      {/* MAIN BODY CONTAINER */}
      <main className="flex flex-col relative w-full px-margin pt-32 pb-24 bg-surface flex-1">
        {currentTab === "settings" ? (
          /* SETTINGS VIEW */
          <div className="flex flex-col gap-space-sm bg-surface-container rounded-lg p-space-sm shadow-sm">
            <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-[18px]">tune</span>
                <span className="font-headline-sm text-headline-sm font-semibold">Extension Settings</span>
              </div>
              <button
                onClick={() => setCurrentTab("transcribe")}
                className="text-on-surface-variant hover:text-on-surface text-[12px] flex items-center gap-0.5"
              >
                Back to Editor <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <SettingsTab />
          </div>
        ) : currentTab === "style" ? (
          /* STYLE & PRESETS FULL BROWSER VIEW */
          <div className="flex flex-col gap-space-sm select-none">
            <div className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-sm">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-space-xs">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-primary text-[18px]">auto_awesome_motion</span>
                  <div>
                    <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      Animation Presets Library
                    </h2>
                    <p className="font-label-xs text-label-xs text-on-surface-variant">
                      {availablePresets.length} Presets • {customPresets.length} Saved Custom
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-space-xs">
                  <button
                    onClick={handleSaveCustomPreset}
                    className="px-space-sm py-1 bg-primary-container/70 hover:bg-primary-container rounded text-on-primary-container font-label-xs text-label-xs flex items-center gap-1 transition-colors cursor-pointer"
                    title="Save the current font, colours, grouping, and animation settings as a custom preset"
                  >
                    <span className="material-symbols-outlined text-[14px]">bookmark_add</span>
                    <span>Save Current</span>
                  </button>
                  <button
                    onClick={() => setCurrentTab("transcribe")}
                    className="px-space-sm py-1 bg-surface-container-high hover:bg-surface-variant rounded text-on-surface font-label-xs text-label-xs flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">visibility</span>
                    <span>View in Canvas</span>
                  </button>
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div className="flex flex-col gap-space-xs">
                <div className="relative flex items-center bg-surface-container-lowest px-space-sm py-1 rounded-md border border-outline-variant/30">
                  <span className="material-symbols-outlined text-on-surface-variant text-[15px] mr-1.5">search</span>
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search by name, number, or style (e.g. #51, Rotate, YouTube, AMV)..."
                    className="bg-transparent text-on-surface text-body-sm font-body-sm w-full outline-none placeholder:text-on-surface-variant/60"
                  />
                  {librarySearch && (
                    <button
                      onClick={() => setLibrarySearch("")}
                      className="text-on-surface-variant hover:text-on-surface text-[12px] cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-space-xs pt-0.5">
                  {[
                    "All",
                    "TikTok / Reels / Shorts",
                    "YouTube",
                    "AMV / Edits",
                    "Music Videos / Lyric Videos",
                    "Storytelling & Movie",
                    "Kinetic Motion",
                  ].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setLibraryFilter(cat)}
                      className={`shrink-0 px-space-sm py-1 rounded font-label-xs text-label-xs whitespace-nowrap transition-all cursor-pointer ${
                        libraryFilter === cat
                          ? "bg-primary text-on-primary font-bold shadow-xs"
                          : "bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-variant"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preset Cards Grid */}
              <div className="grid grid-cols-1 gap-space-sm pt-space-xs max-h-[65vh] overflow-y-auto pr-1">
                {tabFilteredPresets.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  const renderSupport = getPresetRenderSupport(preset.animMode);
                  return (
                    <div
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className={`group relative flex flex-col p-space-sm rounded-lg cursor-pointer transition-all border ${
                        isSelected
                          ? "bg-surface-container-highest border-primary ring-1 ring-primary shadow-md"
                          : "bg-surface-container-low hover:bg-surface-container-high border-outline-variant/20 shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-space-sm">
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-space-xs flex-wrap">
                            <span className="bg-surface-container font-mono text-[9px] text-on-surface-variant px-1 rounded">
                              #{preset.num}
                            </span>
                            <span className="font-headline-xs text-headline-xs text-on-surface font-bold">
                              {preset.name}
                            </span>
                            <span
                              className={`font-label-xs text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${preset.accentBadge}`}
                            >
                              {preset.tag}
                            </span>
                          </div>
                          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 text-[11px] leading-tight">
                            {preset.whatItLooksLike} • {preset.description}
                          </p>
                          <span
                            title={renderSupport.description}
                            className={`mt-1 self-start font-label-xs text-[8px] px-1.5 py-0.5 rounded font-mono ${renderSupport.level === "native-shape" ? "bg-secondary/15 text-secondary" : renderSupport.level === "native-motion" ? "bg-primary/15 text-primary" : "bg-error/10 text-error"}`}
                          >
                            {renderSupport.label}
                          </span>
                        </div>

                        <div className="shrink-0 flex items-center justify-end">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              applyPreset(preset);
                            }}
                            className={`h-6 px-space-sm rounded font-label-xs text-label-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                              isSelected
                                ? "bg-primary text-on-primary shadow-xs"
                                : "bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {isSelected ? "check" : "play_arrow"}
                            </span>
                            <span>{isSelected ? "Active" : "Apply"}</span>
                          </button>
                          {preset.id.startsWith("custom-") && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteCustomPreset(preset.id);
                              }}
                              className="h-6 px-2 rounded bg-error/15 hover:bg-error/25 text-error font-label-xs text-label-xs cursor-pointer"
                              title={`Delete custom preset ${preset.name}`}
                              aria-label={`Delete custom preset ${preset.name}`}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Specs Row */}
                      <div className="flex items-center gap-space-xs flex-wrap mt-2 pt-1 border-t border-outline-variant/20">
                        <span className="bg-surface-container font-label-xs text-[9px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                          {preset.wordsPerGroup}w/group
                        </span>
                        <span className="bg-surface-container font-label-xs text-[9px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                          Bounce: {preset.bounceScale}%
                        </span>
                        <span className="bg-surface-container font-label-xs text-[9px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                          Size: {preset.fontSize}px
                        </span>
                        <span className="flex items-center gap-1 bg-surface-container font-label-xs text-[9px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: preset.highlightColor }}
                          />
                          {preset.highlightColor}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* TRANSCRIBE & LIVE MOTION CANVAS VIEW */
          <div className="flex flex-col w-full gap-space-sm select-none">
            {/* AUDIO & EXTRACTION CARD */}
            <section className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-xs">
              {/* Header status bar */}
              <div className="flex items-center justify-between min-w-0">
                <div className="flex items-center gap-space-xs min-w-0">
                  <span className="material-symbols-outlined text-[14px] text-tertiary-container animate-pulse">
                    bolt
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-semibold">
                    Groq Speech Engine
                  </span>
                </div>
                <div className="flex items-center gap-space-xs shrink-0 bg-surface-container-lowest px-space-xs py-[2px] rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
                  <span className="font-label-xs text-label-xs text-primary font-semibold">
                    {model === "whisper-large-v3-turbo" ? "Turbo" : "Large v3"}
                  </span>
                </div>
              </div>

              {/* Interactive Waveform Visualizer Area */}
              <div
                className="relative w-full h-16 bg-surface-container-lowest rounded overflow-hidden flex flex-col justify-end p-space-xs group cursor-pointer"
                id="waveform-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
                  setScrubberPos(Math.round(pct));
                }}
              >
                {/* Glow Underlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-primary-container/10 via-secondary-container/20 to-transparent pointer-events-none"></div>

                {/* Timecode display overlay */}
                <div className="absolute top-1 left-1.5 z-10 flex items-center gap-space-xs pointer-events-none">
                  <span className="font-label-xs text-label-xs text-primary bg-surface-dim/80 px-space-xs rounded font-mono">
                    {timecodeDisplay.split("/")[0].trim()}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">
                    / {timecodeDisplay.split("/")[1]?.trim()}
                  </span>
                </div>

                {/* Word markers are derived from the current transcript, not hard-coded placeholders. */}
                {hasTranscript && activeWords.filter((_word, index) => index % 5 === 0).map((word, markerIndex) => {
                  const info = transcribedLayer.current;
                  const time = info
                    ? info.startTime + (info.sourceInSeconds + word.start) * (info.stretchPercent / 100)
                    : word.start;
                  const position = Math.max(0, Math.min(100, (time / previewDuration) * 100));
                  return (
                    <div
                      key={`word-marker-${markerIndex}-${word.start}`}
                      className="absolute top-0 bottom-0 w-px bg-primary/40 pointer-events-none"
                      style={{ left: `${position}%` }}
                    />
                  );
                })}

                {/* Real waveform peaks computed from the selected source audio. */}
                <div
                  className="absolute bottom-1 h-10 flex items-end justify-between gap-[1px] px-0.5 z-0 opacity-90 overflow-hidden"
                  style={{ left: `${waveformClipLeft}%`, width: `${waveformClipWidth}%` }}
                >
                  {waveformHeights && waveformHeights.length ? waveformHeights.map((height, idx) => {
                    const isHigh = height > 60;
                    return (
                      <span
                        key={idx}
                        className={`flex-1 min-w-[1px] rounded-t-xs transition-colors ${isHigh ? "bg-primary shadow-[0_0_6px_#c0c1ff]" : height > 30 ? "bg-primary-container" : "bg-outline-variant"}`}
                        style={{ height: `${height}%` }}
                      />
                    );
                  }) : (
                    <span className="w-full text-center text-[9px] text-on-surface-variant font-mono">
                      {waveformStatus}
                    </span>
                  )}
                </div>

                {/* Playhead & Scrubber Cursor */}
                <div
                  className="absolute inset-y-0 w-[2px] bg-secondary flex flex-col items-center pointer-events-none z-20 transition-all duration-75"
                  style={{ left: `${scrubberPos}%` }}
                >
                  <div className="w-2.5 h-3 bg-secondary rounded-b-xs shadow-[0_0_8px_#d0bcff] flex items-center justify-center -mt-0.5">
                    <div className="w-0.5 h-1.5 bg-on-secondary rounded-full"></div>
                  </div>
                </div>
              </div>

              {/* Quick Settings: Model / Auto-Detect */}
              <div className="grid grid-cols-2 gap-space-xs mt-space-xs">
                <div className="relative flex items-center justify-between bg-surface-container-low px-space-sm py-[5px] rounded hover:bg-surface-container-high transition-colors">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[14px] text-tertiary-container">speed</span>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value as GroqModel)}
                      className="bg-transparent text-on-surface font-label-xs text-label-xs appearance-none outline-none cursor-pointer pr-4 truncate"
                    >
                      {MODEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-surface-container text-on-surface">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="material-symbols-outlined text-[14px] text-on-surface-variant pointer-events-none">
                    arrow_drop_down
                  </span>
                </div>

                <div className="relative flex items-center justify-between bg-surface-container-low px-space-sm py-[5px] rounded hover:bg-surface-container-high transition-colors">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[14px] text-primary">translate</span>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-transparent text-on-surface font-label-xs text-label-xs appearance-none outline-none cursor-pointer pr-4 truncate"
                    >
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-surface-container text-on-surface">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">US</span>
                </div>
              </div>

              {/* Vocabulary / Glossary chips */}
              <div className="flex items-center gap-space-xs flex-wrap py-0.5">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider shrink-0 mr-0.5 font-semibold">
                  Glossary:
                </span>
                {glossary.map((tag) => (
                  <span
                    key={tag}
                    className="bg-surface-container-highest text-primary font-label-xs text-label-xs px-space-xs py-[1px] rounded flex items-center gap-0.5"
                  >
                    {tag}
                    <span
                      onClick={() => removeGlossaryTag(tag)}
                      className="material-symbols-outlined text-[10px] text-on-surface-variant cursor-pointer hover:text-on-surface"
                    >
                      close
                    </span>
                  </span>
                ))}
                {isAddingTag ? (
                  <div className="flex items-center gap-1 bg-surface-container-low px-space-xs py-[1px] rounded">
                    <input
                      type="text"
                      value={newGlossaryTag}
                      onChange={(e) => setNewGlossaryTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddGlossaryTag()}
                      placeholder="Tag..."
                      className="bg-transparent text-on-surface text-[10px] w-12 outline-none font-mono"
                      autoFocus
                    />
                    <button onClick={handleAddGlossaryTag} className="text-primary text-[10px]">
                      ✓
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsAddingTag(true)}
                    className="bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-xs text-label-xs px-space-xs py-[1px] rounded transition-colors flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[11px]">add</span>Add
                  </button>
                )}
              </div>

              {/* Transcribe Trigger & Telemetry Status */}
              <div className="flex items-center justify-between gap-space-sm pt-space-xs bg-surface-container-lowest/50 p-space-xs rounded">
                <div className="flex items-center gap-space-xs min-w-0">
                  <span className="material-symbols-outlined text-[14px] text-primary">check_circle</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant truncate">
                    {transcribeStatus}
                  </span>
                </div>
                <button
                  onClick={isTranscribing ? handleCancelTranscribe : handleTranscribe}
                  className="h-6 px-space-md bg-secondary-container hover:bg-secondary-container/90 text-on-secondary-container font-headline-xs text-headline-xs rounded flex items-center gap-space-xs transition-all shrink-0 active:scale-95 shadow-sm disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[13px] ${isTranscribing ? "animate-spin" : ""}`}>
                    refresh
                  </span>
                  <span>{isTranscribing ? "Cancel" : hasTranscript ? "Re-Transcribe" : "Transcribe"}</span>
                </button>
              </div>
            </section>

            {/* EDITABLE TRANSCRIPT */}
            <section className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-xs select-text">
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[14px] text-secondary">edit_note</span>
                  <span className="font-headline-xs text-headline-xs text-on-surface font-semibold">Transcript editor</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {hasTranscript ? `${activeWords.length} words` : "Waiting for transcription"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["srt", "vtt", "json"] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => handleExport(format)}
                      disabled={!hasTranscript || isTranscribing || isBuilding}
                      className="h-7 px-2 rounded bg-surface-container-high hover:bg-surface-variant text-on-surface text-[10px] font-semibold disabled:opacity-40"
                      title={`Export current edited transcript as ${format.toUpperCase()}`}
                    >
                      Export {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <p className="font-label-xs text-label-xs text-on-surface-variant">
                Click a word to correct its text or timing, remove an unwanted word, or insert a missing word. Edits are used for both After Effects generation and exports.
              </p>
              {hasTranscript && transcriptRecoveryNotice && (
                <p className="font-label-xs text-label-xs text-on-surface-variant" role="status">
                  {transcriptRecoveryNotice}
                </p>
              )}
              <TranscriptEditor
                key={transcriptRevision}
                words={hasTranscript ? activeWords : []}
                activeWordIndex={activeWordIndex}
                disabled={isTranscribing || isBuilding}
                onSelectWord={seekToWord}
                onChange={(words, focusIndex) => {
                  setActiveWords(words);
                  setHasTranscript(words.length > 0);
                  setIsTranscriptEdited(true);
                  const info = transcribedLayer.current;
                  if (info) {
                    try {
                      const saved = saveRecoveredTranscript(info, words, transcriptLanguage, true);
                      setTranscriptRecoveryNotice(
                        saved
                          ? "Edits are saved locally for this project and layer."
                          : "Save the After Effects project to enable local transcript recovery."
                      );
                    } catch {
                      setTranscriptRecoveryNotice("Local recovery could not be saved. Export the transcript as JSON to keep a backup.");
                    }
                  }
                  setActiveWordIndex((index) => {
                    const preferred = focusIndex === undefined ? index : focusIndex;
                    return Math.max(0, Math.min(preferred, Math.max(0, words.length - 1)));
                  });
                }}
              />
            </section>

            {/* LIVE PREVIEW CANVAS (CENTERPIECE) */}
            <section className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-xs">
              {/* Viewport Header Toolbar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[14px] text-primary">videocam</span>
                  <span className="font-headline-xs text-headline-xs text-on-surface font-semibold">Live Preview</span>
                </div>
                {/* Aspect Ratio Switcher */}
                <div className="flex items-center bg-surface-container-lowest p-[2px] rounded gap-[2px]">
                  {(["9:16", "16:9", "1:1"] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`px-space-xs py-[2px] rounded font-label-xs text-label-xs transition-colors ${
                        aspectRatio === ratio
                          ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs"
                          : "text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Simulator Frame (TikTok/Reel Viewport) */}
              <div
                className={`relative w-full ${
                  aspectRatio === "9:16"
                    ? "aspect-[9/16]"
                    : aspectRatio === "16:9"
                    ? "aspect-[16/9]"
                    : "aspect-square"
                } bg-surface-container-lowest rounded-md overflow-hidden flex flex-col justify-between p-space-md shadow-inner group transition-all duration-300`}
              >
                {/* Background Placeholder */}
                <div className="absolute inset-0 bg-gradient-to-b from-surface-container-high/60 via-surface-container-lowest to-surface-container-high/40 pointer-events-none" />

                {/* Grid Overlay Guides */}
                <div className="absolute inset-0 bg-[radial-gradient(#353535_1px,transparent_1px)] [background-size:16px_16px] opacity-30 pointer-events-none"></div>

                {/* Creator UI Overlays */}
                <div className="relative z-10 flex justify-between items-center w-full">
                  <div className="flex items-center gap-space-xs bg-surface-dim/70 backdrop-blur-sm px-space-xs py-[2px] rounded">
                    <span className={`w-1.5 h-1.5 rounded-full bg-error ${isPlaying ? "animate-ping" : ""}`}></span>
                    <span className="font-label-xs text-label-xs text-on-surface font-mono">REC 60 FPS</span>
                  </div>
                  <div className="flex items-center gap-1 bg-surface-dim/70 backdrop-blur-sm px-space-xs py-[2px] rounded">
                    <span className="material-symbols-outlined text-[12px] text-primary">aspect_ratio</span>
                    <span className="font-label-xs text-label-xs text-on-surface font-mono">
                      {aspectRatio === "9:16" ? "1080x1920" : aspectRatio === "16:9" ? "1920x1080" : "1080x1080"}
                    </span>
                  </div>
                </div>

                {/* CENTERSTAGE CAPTION: Word-by-Word Kinetic Display with Active Preset Styling */}
                <div
                  className={`pca-font-scope relative z-10 my-auto flex flex-col items-center justify-center text-center px-space-sm pointer-events-none transition-transform duration-200 w-full${isStaticAnimation ? " gc-static-caption-preview" : ""}`}
                  style={
                    {
                      transform: `translateY(${yOffset / 8}px)`,
                      "--pca-font-family": previewFont.fontFamily,
                      "--pca-font-weight": previewFont.fontWeight,
                      "--pca-font-style": previewFont.fontStyle,
                    } as CSSProperties
                  }
                >
                  {/* Preset Contextual Containers: Reddit, Tweet, Terminal, Search, Sticky Note, Newspaper, etc. */}
                  {currentPreset.animMode === "reddit" && (
                    <div className="mb-2 bg-[#1A1A1B] border border-outline-variant/40 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-lg max-w-[90%] text-left">
                      <div className="w-5 h-5 rounded-full bg-[#FF4500] flex items-center justify-center text-[10px] text-white font-black shrink-0">
                        r/
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold text-white leading-none">r/AskReddit</span>
                        <span className="text-[9px] text-on-surface-variant font-mono">Posted by u/creative_editor • 4h ago</span>
                      </div>
                    </div>
                  )}

                  {currentPreset.animMode === "tweet" && (
                    <div className="mb-2 bg-black/85 border border-outline-variant/40 px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 shadow-lg w-full max-w-[90%] text-left">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                          𝕏
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-bold text-white truncate">Viral Motion</span>
                            <span className="material-symbols-outlined text-sky-400 text-[13px]">verified</span>
                          </div>
                          <span className="text-[9px] text-on-surface-variant font-mono">@pro_captions</span>
                        </div>
                      </div>
                      <span className="text-[9px] text-on-surface-variant font-mono shrink-0">Just now</span>
                    </div>
                  )}

                  {currentPreset.animMode === "terminal" && (
                    <div className="bg-black/90 border border-green-500/40 p-3 rounded-md shadow-2xl font-mono text-left w-full max-w-[90%] mb-2">
                      <div className="text-[9px] text-green-400 mb-1.5 flex items-center justify-between opacity-80 border-b border-green-950 pb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                          <span>bash • 80x24 (Ae Pro v1.0)</span>
                        </div>
                        <span className="text-green-600 font-mono">UTF-8</span>
                      </div>
                      <div className="text-green-400 font-mono flex items-center flex-wrap gap-1.5">
                        <span className="text-green-500/70">guest@ae-studio:~$</span>
                        <span className="text-white font-semibold">say --kinetic</span>
                        <div
                          key={`terminal-${activeWordIndex}`}
                          className="font-bold underline text-green-300 bg-green-950/80 px-1.5 py-0.5 rounded live-anim-stat-card"
                          style={{ fontSize: `${Math.round(fontSize * 0.28)}px` }}
                        >
                          "{activeWords[activeWordIndex]?.text || "CAPTIONS"}"
                        </div>
                        <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse align-middle"></span>
                      </div>
                    </div>
                  )}

                  {currentPreset.animMode === "search-bar" && (
                    <div className="flex items-center gap-2 bg-[#202124] border border-[#5F6368] px-3.5 py-1.5 rounded-full shadow-xl max-w-[90%] mb-2">
                      <span className="material-symbols-outlined text-[15px] text-on-surface-variant">search</span>
                      <div
                        key={`search-${activeWordIndex}`}
                        className="font-bold uppercase tracking-tight text-white live-anim-node live-anim-pop"
                        style={{ fontSize: `${Math.round(fontSize * 0.28)}px` }}
                      >
                        {activeWords[activeWordIndex]?.text}
                      </div>
                      <span className="w-0.5 h-4 bg-primary animate-pulse ml-0.5"></span>
                      <span className="material-symbols-outlined text-[15px] text-primary ml-auto">mic</span>
                    </div>
                  )}

                  {currentPreset.animMode === "sticky-note" && (
                    <div className="relative bg-yellow-300 text-yellow-950 p-4 rounded-sm shadow-2xl transform -rotate-1 max-w-[85%] border-b-2 border-yellow-500 text-center mb-2">
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-10 h-4 bg-amber-200/80 border border-amber-300/60 rounded-xs shadow-xs"></div>
                      <div
                        key={`sticky-${activeWordIndex}`}
                        className="font-black uppercase tracking-tight block text-yellow-950 live-anim-node live-anim-pop"
                        style={{ fontSize: `${Math.round(fontSize * 0.34)}px` }}
                      >
                        {activeWords[activeWordIndex]?.text}
                      </div>
                    </div>
                  )}

                  {currentPreset.animMode === "newspaper" && (
                    <div className="bg-[#FAF6EE] text-neutral-900 border-2 border-neutral-800 p-3 rounded shadow-2xl max-w-[90%] text-center mb-2">
                      <div className="text-[8px] font-serif uppercase tracking-widest text-neutral-600 border-b border-neutral-300 pb-0.5 mb-1.5">
                        DAILY CHRONICLE • EXTRA EDITION
                      </div>
                      <div
                        key={`newspaper-${activeWordIndex}`}
                        className="font-serif font-black uppercase tracking-tight text-neutral-900 live-anim-node live-anim-newspaper"
                        style={{ fontSize: `${Math.round(fontSize * 0.34)}px` }}
                      >
                        {activeWords[activeWordIndex]?.text}
                      </div>
                    </div>
                  )}

                  {currentPreset.animMode === "stat-card" && (
                    <div className="bg-surface-container-high/90 border border-primary/30 backdrop-blur-md p-3 rounded-xl shadow-2xl max-w-[85%] flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-black text-[18px]">
                        ▲
                      </div>
                      <div className="flex flex-col text-left">
                        <div
                          key={`stat-${activeWordIndex}`}
                          className="font-mono font-black text-primary live-anim-node live-anim-stat-card"
                          style={{ fontSize: `${Math.round(fontSize * 0.36)}px` }}
                        >
                          {activeWords[activeWordIndex]?.text}
                        </div>
                        <span className="font-label-xs text-[9px] text-on-surface-variant font-mono">
                          METRIC GROWTH • LIVE
                        </span>
                      </div>
                    </div>
                  )}

                  {/* MAIN CAPTION TEXT DISPLAY */}
                  {wordsPerGroup === 1 || currentPreset.animMode === "single-word" ? (
                    /* 1-WORD GIANT CENTER DISPLAY */
                    <div className="relative flex flex-col items-center justify-center my-1">
                      {currentPreset.animMode === "impact" && (
                        <div className="absolute inset-0 -m-6 bg-yellow-400/20 rounded-full blur-xl animate-ping pointer-events-none"></div>
                      )}
                      {currentPreset.animMode === "repeater-wall" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-20 -z-10 select-none">
                          <span className="font-black text-[22px] tracking-widest text-white/50">{activeWords[activeWordIndex]?.text}</span>
                          <span className="font-black text-[22px] tracking-widest text-white/50">{activeWords[activeWordIndex]?.text}</span>
                        </div>
                      )}

                      <div
                        style={{
                          transform: `scale(${1 + bounceScale / 200})`,
                          transition: "transform 150ms ease-out",
                        }}
                      >
                        <span
                          key={`single-${currentPreset.id}-${activeWordIndex}`}
                          className={`font-black uppercase tracking-tight block live-anim-node ${previewMotionClass ?? (
                            currentPreset.animMode === "rotate"
                              ? "live-anim-rotate"
                              : currentPreset.animMode === "squash"
                              ? "live-anim-squash"
                              : currentPreset.animMode === "shadow-pop"
                              ? "live-anim-shadow-pop"
                              : currentPreset.animMode === "zoom-punch"
                              ? "live-anim-zoom-punch"
                              : currentPreset.animMode === "rainbow"
                              ? "live-anim-rainbow"
                              : currentPreset.animMode === "stroke-fill"
                              ? "live-anim-stroke-fill"
                              : currentPreset.animMode === "sticker"
                              ? "live-anim-sticker"
                              : currentPreset.animMode === "marker"
                              ? "live-anim-marker"
                              : currentPreset.animMode === "wave"
                              ? "live-anim-wave"
                              : currentPreset.animMode === "impact"
                              ? "live-anim-impact"
                              : currentPreset.animMode === "time-skip"
                              ? "live-anim-time-skip"
                              : currentPreset.animMode === "scatter"
                              ? "live-anim-scatter"
                              : currentPreset.animMode === "lens-distort"
                              ? "live-anim-lens-distort"
                              : currentPreset.animMode === "datamosh"
                              ? "live-anim-datamosh"
                              : currentPreset.animMode === "graffiti"
                              ? "live-anim-graffiti"
                              : currentPreset.animMode === "rain"
                              ? "live-anim-rain"
                              : currentPreset.animMode === "invert"
                              ? "live-anim-invert-flash"
                              : currentPreset.animMode === "circle"
                              ? "live-anim-circle-rotate"
                              : currentPreset.animMode === "echo"
                              ? "live-anim-echo"
                              : currentPreset.animMode === "hologram"
                              ? "live-anim-hologram"
                              : currentPreset.animMode === "crawl"
                              ? "live-anim-crawl"
                              : currentPreset.animMode === "thought"
                              ? "live-anim-thought"
                              : "live-anim-single-word")
                          }`}
                          style={{
                            color:
                              currentPreset.animMode === "marker"
                                ? "#111111"
                                : currentPreset.animMode === "split-color"
                                ? "#00F0FF"
                                : highlightColor,
                            backgroundColor:
                              currentPreset.animMode === "marker"
                                ? "#FFE600"
                                : currentPreset.animMode === "sticker"
                                ? "#FFFFFF"
                                : undefined,
                            fontSize: `${Math.round(fontSize * 0.45)}px`,
                            padding:
                              currentPreset.animMode === "marker" || currentPreset.animMode === "sticker"
                                ? "2px 10px"
                                : undefined,
                            borderRadius:
                              currentPreset.animMode === "marker"
                                ? "3px"
                                : currentPreset.animMode === "sticker"
                                ? "6px"
                                : undefined,
                            WebkitTextStroke: effectiveStrokeWidth
                              ? `${Math.max(1, Math.round(effectiveStrokeWidth * 0.45))}px ${currentPreset.strokeColor}`
                              : undefined,
                            textShadow:
                              currentPreset.animMode === "shadow-pop"
                                ? `5px 5px 0px ${highlightColor}`
                                : currentPreset.animMode === "hologram"
                                ? `0 0 16px ${highlightColor}`
                                : "0 4px 14px rgba(0,0,0,0.85)",
                          }}
                        >
                          {activeWords[activeWordIndex]?.text || "POP"}
                        </span>
                      </div>

                      {currentPreset.animMode === "underline" && (
                        <div
                          key={`underline-${activeWordIndex}`}
                          className="w-full h-1.5 rounded-full mt-1.5 shadow-sm live-anim-node"
                          style={{
                            backgroundColor: highlightColor,
                            boxShadow: `0 0 10px ${highlightColor}`,
                            animation: "p-underline 0.45s ease-out forwards",
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    /* MULTI-WORD GROUP DISPLAY (2-word or 3-word chunks) */
                    <div
                      className={`relative flex flex-wrap items-center justify-center gap-x-2 gap-y-1 tracking-tight font-black leading-none drop-shadow-md ${
                        currentPreset.animMode === "blur-box"
                          ? "bg-black/60 backdrop-blur-md border border-white/20 px-3.5 py-2 rounded-xl shadow-2xl"
                          : ""
                      }`}
                    >
                      {currentPreset.animMode === "quote" && (
                        <span className="text-secondary text-[28px] leading-none select-none font-serif mr-1">“</span>
                      )}

                      {/* Display current chunk of words based on wordsPerGroup */}
                      {(() => {
                        const chunkSize = wordsPerGroup;
                        const chunkIdx = Math.floor(activeWordIndex / chunkSize);
                        const start = chunkIdx * chunkSize;
                        const visibleChunk = activeWords.slice(start, start + chunkSize);

                        return visibleChunk.map((item, localIdx) => {
                          const globalIdx = start + localIdx;
                          const isActive = globalIdx === activeWordIndex;
                          const isPast = globalIdx < activeWordIndex;

                          if (isActive) {
                            return (
                              <div
                                key={`active-group-wrap-${globalIdx}`}
                                className="relative inline-flex flex-col items-center justify-center"
                                style={{
                                  transform: `scale(${1 + bounceScale / 220})`,
                                  transition: "transform 150ms ease-out",
                                }}
                              >
                                <span
                                  key={`active-word-${currentPreset.id}-${globalIdx}`}
                                  className={`px-1.5 py-0.5 rounded tracking-tight font-black uppercase live-anim-node ${previewMotionClass ?? (
                                    currentPreset.animMode === "rotate"
                                      ? "live-anim-rotate"
                                      : currentPreset.animMode === "squash"
                                      ? "live-anim-squash"
                                      : currentPreset.animMode === "shadow-pop"
                                      ? "live-anim-shadow-pop"
                                      : currentPreset.animMode === "wave"
                                      ? "live-anim-wave"
                                      : currentPreset.animMode === "zoom-punch"
                                      ? "live-anim-zoom-punch"
                                      : currentPreset.animMode === "rainbow"
                                      ? "live-anim-rainbow"
                                      : currentPreset.animMode === "stroke-fill"
                                      ? "live-anim-stroke-fill"
                                      : currentPreset.animMode === "sticker"
                                      ? "live-anim-sticker"
                                      : currentPreset.animMode === "marker"
                                      ? "live-anim-marker"
                                      : currentPreset.animMode === "outline-pulse" || currentPreset.animMode === "pulse"
                                      ? "live-anim-pulse"
                                      : currentPreset.animMode === "echo"
                                      ? "live-anim-echo"
                                      : currentPreset.animMode === "hologram"
                                      ? "live-anim-hologram"
                                      : currentPreset.animMode === "crawl"
                                      ? "live-anim-crawl"
                                      : currentPreset.animMode === "thought"
                                      ? "live-anim-thought"
                                      : currentPreset.animMode === "impact"
                                      ? "live-anim-impact"
                                      : currentPreset.animMode === "time-skip"
                                      ? "live-anim-time-skip"
                                      : currentPreset.animMode === "scatter"
                                      ? "live-anim-scatter"
                                      : currentPreset.animMode === "lens-distort"
                                      ? "live-anim-lens-distort"
                                      : currentPreset.animMode === "datamosh"
                                      ? "live-anim-datamosh"
                                      : currentPreset.animMode === "graffiti"
                                      ? "live-anim-graffiti"
                                      : currentPreset.animMode === "rain"
                                      ? "live-anim-rain"
                                      : currentPreset.animMode === "invert"
                                      ? "live-anim-invert-flash"
                                      : currentPreset.animMode === "circle"
                                      ? "live-anim-circle-rotate"
                                      : "live-anim-pop")
                                  }`}
                                  style={{
                                    color:
                                      currentPreset.animMode === "marker"
                                        ? "#111111"
                                        : currentPreset.animMode === "split-color"
                                        ? "#00F0FF"
                                        : highlightColor,
                                    backgroundColor:
                                      currentPreset.animMode === "marker"
                                        ? "#FFE600"
                                        : currentPreset.animMode === "sticker"
                                        ? "#FFFFFF"
                                        : undefined,
                                    fontSize: `${Math.round(fontSize * 0.36)}px`,
                                    WebkitTextStroke: effectiveStrokeWidth
                                      ? `${Math.max(1, Math.round(effectiveStrokeWidth * 0.4))}px ${
                                          currentPreset.strokeColor
                                        }`
                                      : undefined,
                                    boxShadow:
                                      currentPreset.animMode === "shadow-pop"
                                        ? `4px 4px 0px ${highlightColor}`
                                        : currentPreset.animMode === "hologram"
                                        ? `0 0 16px ${highlightColor}`
                                        : `0 0 16px ${highlightColor}80`,
                                  }}
                                >
                                  {item.text}
                                </span>

                                {/* Underline swipe decoration */}
                                {currentPreset.animMode === "underline" && (
                                  <div
                                    key={`underline-multi-${globalIdx}`}
                                    className="w-full h-1 rounded-full mt-1 shadow-xs live-anim-node"
                                    style={{
                                      backgroundColor: highlightColor,
                                      animation: "p-underline 0.4s ease-out forwards",
                                    }}
                                  />
                                )}
                              </div>
                            );
                          }

                          return (
                            <span
                              key={`word-${globalIdx}`}
                              className="tracking-tight font-extrabold uppercase transition-all duration-150 inline-block px-0.5"
                              style={{
                                color: baseColor,
                                opacity: isPast ? 0.95 : 0.4,
                                fontSize: `${Math.round(fontSize * 0.3)}px`,
                                WebkitTextStroke: effectiveStrokeWidth
                                  ? `${Math.max(1, Math.round(effectiveStrokeWidth * 0.3))}px ${
                                      currentPreset.strokeColor
                                    }`
                                  : undefined,
                              }}
                            >
                              {item.text}
                            </span>
                          );
                        });
                      })()}

                      {currentPreset.animMode === "quote" && (
                        <span className="text-secondary text-[28px] leading-none select-none font-serif ml-1">”</span>
                      )}
                    </div>
                  )}

                  {/* Progress Bar Chapter indicator */}
                  {currentPreset.animMode === "progress-bar" && (
                    <div className="mt-3 w-48 h-1.5 bg-white/20 rounded-full overflow-hidden shadow-inner">
                      <div
                        className="h-full bg-red-600 transition-all duration-200"
                        style={{ width: `${((activeWordIndex + 1) / activeWords.length) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* Mirror floor reflection simulation */}
                  {currentPreset.animMode === "mirror" && (
                    <div className="opacity-25 transform scale-y-[-1] blur-[0.6px] pointer-events-none mt-1.5 select-none font-bold text-white text-[13px] tracking-wider">
                      {activeWords[activeWordIndex]?.text}
                    </div>
                  )}

                  {/* Subtitle Tracking Anchor Telemetry Indicator */}
                  <div className="pca-font-ignore mt-space-md flex items-center gap-space-xs opacity-75">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">
                      #{currentPreset.num} {currentPreset.name} • {currentPreset.tag} • Y: {yOffset}px
                    </span>
                  </div>
                </div>

                {/* Frame Bottom Scrub & Playback Strip */}
                <div className="relative z-10 flex items-center justify-between bg-surface-dim/85 backdrop-blur-md p-space-xs rounded">
                  {/* Step Back / Play / Step Forward */}
                  <div className="flex items-center gap-space-xs">
                    <button
                      onClick={() => seekToWord(activeWordIndex > 0 ? activeWordIndex - 1 : activeWords.length - 1)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-surface-container-high text-on-surface hover:text-primary transition-colors cursor-pointer"
                      title="Previous Word"
                    >
                      <span className="material-symbols-outlined text-[16px]">skip_previous</span>
                    </button>
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-primary text-on-primary hover:bg-primary-fixed transition-colors cursor-pointer shadow-sm"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isPlaying ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    <button
                      onClick={() => seekToWord((activeWordIndex + 1) % activeWords.length)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-surface-container-high text-on-surface hover:text-primary transition-colors cursor-pointer"
                      title="Next Word"
                    >
                      <span className="material-symbols-outlined text-[16px]">skip_next</span>
                    </button>

                    {/* Speed Selector Pills */}
                    <div className="flex items-center bg-surface-container-lowest p-[1px] rounded gap-[1px] ml-1">
                      {[0.75, 1, 1.5].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => setPlaybackSpeed(spd)}
                          className={`px-1 py-[1px] rounded text-[8.5px] font-mono transition-colors cursor-pointer ${
                            playbackSpeed === spd
                              ? "bg-primary text-on-primary font-bold"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Frame Counter and Scale */}
                  <div className="flex items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
                    <div className="flex items-center gap-1 bg-surface-container-lowest px-space-xs py-[2px] rounded text-on-surface font-mono">
                      <span className="text-primary font-bold">FRM</span>
                      <span>
                        {currentFrame} / {totalFrames}
                      </span>
                    </div>
                    <span className="text-on-surface-variant">100% Fit</span>
                  </div>
                </div>
              </div>
            </section>

            {/* STYLE & PRESET QUICK-TRAY (Top 10 Presets Carousel) */}
            <section className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[14px] text-secondary">auto_awesome_motion</span>
                  <span className="font-headline-xs text-headline-xs text-on-surface font-semibold">
                    Viral Animation Presets ({availablePresets.length})
                  </span>
                </div>
                <button
                  onClick={() => setIsLibraryOpen(true)}
                  className="font-label-xs text-label-xs text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-semibold"
                >
                  Browse Library ({availablePresets.length}){" "}
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                </button>
              </div>

              {/* Horizontal Scrollable Preset Cards Tray */}
              <div className="flex items-center gap-space-sm overflow-x-auto pb-space-xs pt-1 no-scrollbar">
                {availablePresets.map((preset) => {
                  const isSelected = selectedPresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className={`shrink-0 w-32 p-space-xs rounded-lg flex flex-col gap-space-xs cursor-pointer shadow-md transition-all ${
                        isSelected
                          ? "bg-surface-container-highest ring-1 ring-primary bg-gradient-to-b from-primary/10 to-transparent"
                          : "bg-surface-container-low hover:bg-surface-container-high"
                      }`}
                    >
                      <div className="h-14 bg-surface-container-lowest rounded flex flex-col items-center justify-center relative overflow-hidden">
                        <div
                          className="absolute -top-3 -right-3 w-8 h-8 rounded-full blur-sm opacity-30"
                          style={{ backgroundColor: preset.highlightColor }}
                        />
                        <span
                          className="font-black text-[12px] px-space-xs py-0.5 rounded shadow scale-105 font-mono"
                          style={{
                            color: preset.highlightColor,
                            backgroundColor: "#181818",
                            WebkitTextStroke: preset.strokeWidth ? `0.5px ${preset.strokeColor}` : undefined,
                          }}
                        >
                          {preset.tag.split(" ")[0]}
                        </span>
                        <span className="font-label-xs text-[8px] text-on-surface-variant mt-1 tracking-widest uppercase font-mono">
                          {preset.wordsPerGroup}w/group
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-0.5">
                        <span className="font-label-sm text-label-sm font-semibold text-on-surface truncate">
                          {preset.name}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? "bg-primary" : "bg-outline-variant"
                          }`}
                        ></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* KINETIC INSPECTOR (AE LAYER PROPS) */}
            <section className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-sm gap-space-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-[14px] text-primary">tune</span>
                  <span className="font-headline-xs text-headline-xs text-on-surface font-semibold">
                    Kinetic Inspector
                  </span>
                </div>
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">
                  Ae Layer Props
                </span>
              </div>

              {/* Parameter Scrubbers Table */}
              <div className="flex flex-col gap-space-xs mt-0.5">
                {/* Animation (motion) Parameter */}
                <div className="flex items-center justify-between gap-space-sm bg-surface-container-lowest px-space-sm py-1 rounded min-h-[36px]">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[15px] text-on-surface-variant">animation</span>
                    <span className="font-body-sm text-body-sm text-on-surface">Animation</span>
                  </div>
                  <select
                    value={isStaticAnimation ? "static" : motionOverride ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStaticAnimation(value === "static");
                      if (value !== "static") setMotionOverride(value ? (value as MotionType) : null);
                    }}
                    className="h-7 min-w-[150px] bg-surface-container-high text-on-surface font-label-sm text-label-sm rounded px-space-sm cursor-pointer border border-outline-variant/40 focus:border-primary outline-none"
                    title="Motion used in the preview and in After Effects"
                  >
                    <option value="">
                      Preset: {MOTION_OPTIONS.find((o) => o.value === motionForAnimMode(currentPreset.animMode))?.label}
                    </option>
                    <option value="static">None (Static)</option>
                    {MOTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className={`flex items-center justify-between gap-space-sm bg-surface-container-lowest px-space-sm py-1 rounded min-h-[36px] ${hasPresetStroke ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                  <span className="font-body-sm text-body-sm text-on-surface">Text Stroke</span>
                  <span className="flex items-center gap-space-xs">
                    <span className="font-label-xs text-on-surface-variant">{isStrokeEnabled ? "On" : "Off"}</span>
                    <input
                      type="checkbox"
                      checked={isStrokeEnabled}
                      disabled={!hasPresetStroke}
                      onChange={(event) => setStrokeEnabled(event.target.checked)}
                      aria-label="Enable text stroke"
                      title={hasPresetStroke ? "Enable or remove this preset's text stroke" : "This preset has no text stroke"}
                    />
                  </span>
                </label>

                <FontPicker
                  value={fontOverride}
                  presetFont={currentPreset.font || DEFAULT_CAPTION_STYLE.font}
                  fonts={fontList?.fonts ?? []}
                  source={fontList?.source ?? null}
                  loading={fontsLoading}
                  onOpen={ensureFonts}
                  onChange={chooseFont}
                  onRefresh={refreshFonts}
                />

                {/* Font Size Parameter */}
                <div className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1 rounded">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant">format_size</span>
                    <span className="font-body-sm text-body-sm text-on-surface">Font Size</span>
                  </div>
                  <div className="flex items-center gap-space-xs shrink-0">
                    <input
                      type="range"
                      min="32"
                      max="140"
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-20 h-1 bg-surface-variant rounded appearance-none cursor-pointer accent-primary"
                    />
                    <div className="w-12 h-5 bg-surface-container-high rounded flex items-center justify-end px-1.5 cursor-ew-resize hover:bg-surface-variant">
                      <span className="font-label-sm text-label-sm text-primary font-mono">{fontSize}px</span>
                    </div>
                  </div>
                </div>

                {/* Words Per Group Parameter */}
                <div className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1 rounded">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant">short_text</span>
                    <span className="font-body-sm text-body-sm text-on-surface">Words / Group</span>
                  </div>
                  <div className="flex items-center gap-space-xs shrink-0">
                    <div className="flex items-center bg-surface-container-high rounded p-[2px] gap-[2px]">
                      {([1, 2, 3] as const).map((num) => (
                        <button
                          key={num}
                          onClick={() => setWordsPerGroup(num)}
                          className={`w-5 h-4 flex items-center justify-center font-label-xs text-label-xs rounded transition-colors ${
                            wordsPerGroup === num
                              ? "bg-primary text-on-primary font-bold"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                    <div className="w-12 h-5 bg-surface-container-high rounded flex items-center justify-end px-1.5 cursor-ew-resize font-mono text-[10px]">
                      <span className="font-label-sm text-label-sm text-on-surface font-mono">1–{wordsPerGroup}w</span>
                    </div>
                  </div>
                </div>

                {/* Bounce Intensity Parameter */}
                <div className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1 rounded">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant">4k</span>
                    <span className="font-body-sm text-body-sm text-on-surface">Bounce Scale</span>
                  </div>
                  <div className="flex items-center gap-space-xs shrink-0">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={bounceScale}
                      onChange={(e) => setBounceScale(Number(e.target.value))}
                      className="w-20 h-1 bg-surface-variant rounded appearance-none cursor-pointer accent-primary"
                    />
                    <div className="w-12 h-5 bg-surface-container-high rounded flex items-center justify-end px-1.5 cursor-ew-resize hover:bg-surface-variant">
                      <span className="font-label-sm text-label-sm text-primary font-mono">{bounceScale}%</span>
                    </div>
                  </div>
                </div>

                {/* Y-Offset Position Parameter */}
                <div className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1 rounded">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant">
                      vertical_align_bottom
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface">Y-Offset</span>
                  </div>
                  <div className="flex items-center gap-space-xs shrink-0">
                    <input
                      type="range"
                      min="-300"
                      max="300"
                      value={yOffset}
                      onChange={(e) => setYOffset(Number(e.target.value))}
                      className="w-20 h-1 bg-surface-variant rounded appearance-none cursor-pointer accent-primary"
                    />
                    <div className="w-12 h-5 bg-surface-container-high rounded flex items-center justify-end px-1.5 cursor-ew-resize hover:bg-surface-variant">
                      <span className="font-label-sm text-label-sm text-on-surface font-mono">{yOffset}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dual Color Swatches */}
              <div className="grid grid-cols-2 gap-space-xs mt-space-xs">
                <label className="relative flex items-center justify-between min-h-[36px] bg-surface-container-lowest px-space-sm rounded cursor-pointer hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span
                      className="w-4 h-4 rounded-sm shadow-xs border border-outline-variant/30"
                      style={{ backgroundColor: baseColor }}
                    />
                    <span className="font-label-xs text-label-xs text-on-surface truncate">Base Text</span>
                  </div>
                  <input
                    type="color"
                    value={baseColor}
                    onChange={(e) => setBaseColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">{baseColor}</span>
                </label>

                <label className="relative flex items-center justify-between min-h-[36px] bg-surface-container-lowest px-space-sm rounded cursor-pointer hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span
                      className="w-4 h-4 rounded-sm shadow-xs border border-outline-variant/30"
                      style={{ backgroundColor: highlightColor }}
                    />
                    <span className="font-label-xs text-label-xs text-on-surface truncate">Highlight</span>
                  </div>
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={(e) => setHighlightColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <span className="font-label-xs text-label-xs text-secondary font-mono font-semibold">
                    {highlightColor}
                  </span>
                </label>
              </div>

              {/* Pro Sync Automation Toggles */}
              <div className="flex flex-col gap-space-xs pt-space-xs">
                <label className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1.5 rounded cursor-pointer group">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-primary">auto_fix_high</span>
                    <span className="font-body-sm text-body-sm text-on-surface group-hover:text-primary transition-colors">
                      Auto-Snap to Audio Onsets
                    </span>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSnapOnsets}
                      onChange={(e) => setAutoSnapOnsets(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-primary after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                  </div>
                </label>
                {isTranscriptEdited && autoSnapOnsets && (
                  <p className="px-space-sm text-[10px] text-on-surface-variant">
                    Auto-snap will be skipped for this edited transcript so your manual word timings stay intact.
                  </p>
                )}

                <label className="flex items-center justify-between bg-surface-container-lowest px-space-sm py-1.5 rounded cursor-pointer group">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className="material-symbols-outlined text-[13px] text-tertiary-container">content_cut</span>
                    <span className="font-body-sm text-body-sm text-on-surface group-hover:text-tertiary-container transition-colors">
                      Split on Pauses (&gt;300ms)
                    </span>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitOnPauses}
                      onChange={(e) => setSplitOnPauses(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-primary after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                  </div>
                </label>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* FIXED BOTTOM ACTION BAR */}
      <footer className="fixed bottom-0 w-full z-40 pb-safe bg-surface-container/95 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.5)] border-t border-outline-variant/30">
        <div className="h-16 px-margin flex items-center justify-between gap-space-sm">
          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center gap-space-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              <span className="font-label-sm text-label-sm text-on-surface font-medium truncate">
                Ready to Sync • {currentPreset.name}
              </span>
            </div>
            <span className="font-label-xs text-label-xs text-on-surface-variant truncate">
              {hasTranscript ? `${activeWords.length} words` : "No transcript yet"} • {wordsPerGroup}w/group
            </span>
          </div>
          <button
            onClick={handleBuildInAe}
            disabled={isBuilding || isTranscribing || !hasTranscript}
            className="h-10 min-w-[140px] px-space-lg rounded bg-primary text-on-primary flex items-center justify-center gap-space-xs font-headline-xs text-headline-xs font-semibold hover:bg-primary-fixed transition-all shrink-0 active:scale-95 disabled:opacity-50 shadow-md cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[18px] ${isBuilding ? "animate-spin" : ""}`}>
              {isBuilding ? "autorenew" : "bolt"}
            </span>
            <span>{isBuilding ? "Building..." : "Build in AE"}</span>
          </button>
        </div>
      </footer>

      {/* PRESET LIBRARY MODAL (FULL BROWSE LIBRARY) */}
      <PresetLibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        activePresetId={selectedPresetId}
        presets={availablePresets}
        onSelectPreset={(preset) => {
          applyPreset(preset);
          setIsLibraryOpen(false);
        }}
      />
    </div>
  );
};

export const App = () => (
  <ToastProvider>
    <AppContent />
  </ToastProvider>
);
export default App;
