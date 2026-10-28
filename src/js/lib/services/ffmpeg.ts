import { child_process, fs, os, path } from "../cep/node";
import { compressWaveformSamples } from "../../../shared/waveform";
import { assertNodeAvailable } from "./env";
import { getStoredFfmpegPath, setStoredFfmpegPath } from "./settingsStore";

const candidatePaths = (): string[] => {
  const platform = os.platform();
  if (platform === "win32") {
    const localAppData = window.cep_node.process.env.LOCALAPPDATA || "";
    return [
      path.join(localAppData, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
      path.join(os.homedir(), "scoop", "shims", "ffmpeg.exe"),
    ];
  }
  return ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
};

const which = (): string | null => {
  const platform = os.platform();
  try {
    const out = child_process
      .execSync(platform === "win32" ? "where ffmpeg" : "command -v ffmpeg", {
        encoding: "utf-8",
        timeout: 5000,
      })
      .split(/\r?\n/)[0]
      .trim();
    return out && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
};

/** Locates an ffmpeg binary: a user override wins, then common per-OS install locations,
 * then falling back to the shell's own PATH lookup. Returns null if nothing was found, in
 * which case the caller should offer the direct-upload path or ask the user to install/locate
 * ffmpeg (see src/jsx/aeft/aeft.ts#pickFfmpegExecutable for the native file-picker). */
export const findFfmpeg = (): string | null => {
  assertNodeAvailable();
  const override = getStoredFfmpegPath();
  if (override && fs.existsSync(override)) return override;

  for (const candidate of candidatePaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return which();
};

export const setFfmpegOverride = (ffmpegPath: string | null): void => {
  setStoredFfmpegPath(ffmpegPath);
};

export interface ExtractAudioHandle {
  promise: Promise<string>;
  cancel: () => void;
  /** The temp file ffmpeg will write to, known synchronously so a canceller can clean up
   * even before the promise settles (see removeTempFile). */
  outPath: string;
}

/** Extracts only the used portion of the source clip as 16kHz mono FLAC, matching what Groq's
 * Whisper endpoint expects. Runs as a background child process so it never blocks After
 * Effects' UI thread (it isn't even running there — this is the CEP panel's Node context). */
export const extractAudio = (
  ffmpegPath: string,
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number
): ExtractAudioHandle => {
  assertNodeAvailable();
  const outPath = path.join(
    os.tmpdir(),
    `groqcap_audio_${Date.now()}_${Math.round(Math.random() * 1e6)}.flac`
  );

  const cleanupPartial = () => {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      // best-effort: a killed ffmpeg can still hold the file handle briefly on Windows
    }
  };

  let child: any;
  const promise = new Promise<string>((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startSeconds.toFixed(3),
      "-t",
      durationSeconds.toFixed(3),
      "-i",
      sourcePath,
      "-vn",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "flac",
      outPath,
    ];
    child = child_process.execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 10 }, (
      err: Error | null,
      _stdout: string,
      stderr: string
    ) => {
      if (err) {
        cleanupPartial();
        reject(new Error(`ffmpeg could not extract audio.\n${stderr || err.message}`));
        return;
      }
      if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100) {
        cleanupPartial();
        reject(new Error(`ffmpeg could not extract audio.\n${stderr}`));
        return;
      }
      resolve(outPath);
    });
  });

  return {
    promise,
    outPath,
    cancel: () => {
      try {
        child?.kill();
      } catch {
        // already exited
      }
    },
  };
};

export const getFileSizeBytes = (filePath: string): number => {
  assertNodeAvailable();
  return fs.statSync(filePath).size;
};

export const removeTempFile = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort cleanup only
  }
};


/**
 * Reads a low-rate mono PCM stream from FFmpeg and reduces it to a small set of real
 * peak bars. The output is bounded so a long source does not require an unbounded buffer.
 */
export const extractWaveformPeaks = (
  ffmpegPath: string,
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number,
  barCount = 64
): Promise<number[]> => {
  assertNodeAvailable();
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return Promise.reject(new Error("FFmpeg was not found. Locate ffmpeg in Settings to analyze the audio waveform."));
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return Promise.reject(new Error("The selected source media could not be found."));
  }
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(durationSeconds) ||
    startSeconds < 0 ||
    durationSeconds <= 0
  ) {
    return Promise.reject(new Error("The selected audio range is invalid."));
  }

  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-ss", startSeconds.toFixed(3),
    "-t", durationSeconds.toFixed(3),
    "-i", sourcePath,
    "-vn",
    "-ac", "1",
    "-ar", "200",
    "-f", "s16le",
    "pipe:1",
  ];

  return new Promise((resolve, reject) => {
    child_process.execFile(
      ffmpegPath,
      args,
      { encoding: "buffer", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (err: Error | null, stdout: Buffer | string, stderr: Buffer | string) => {
        if (err) {
          const details = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
          reject(new Error("Could not analyze the selected audio waveform. " + (details || err.message)));
          return;
        }

        const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
        const sampleCount = Math.floor(pcm.length / 2);
        if (!sampleCount) {
          reject(new Error("FFmpeg returned no audio samples for the selected layer."));
          return;
        }

        const samples = new Array<number>(sampleCount);
        for (let index = 0; index < sampleCount; index++) {
          samples[index] = pcm.readInt16LE(index * 2) / 32768;
        }
        const peaks = compressWaveformSamples(samples, barCount);
        if (!peaks.length) {
          reject(new Error("A usable waveform could not be generated from this audio."));
          return;
        }
        resolve(peaks);
      }
    );
  });
};
