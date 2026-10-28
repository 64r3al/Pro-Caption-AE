import { crypto, fs, https } from "../cep/node";
import { assertNodeAvailable } from "./env";
import { GROQ_TRANSCRIPTION_URL } from "../../../shared/constants";
import type { GroqModel, TranscriptResult } from "../../../shared/types";
import { normalizeTranscriptWords } from "../../../shared/transcriptValidation";
import { computeRetryDelayMs } from "../../../shared/retry";
import { safeUploadFilename } from "../../../shared/uploadFilename";

// We build the multipart/form-data body by hand instead of pulling in the npm `form-data`
// package the master prompt's reference snippet uses: CEP's Node module resolution only sees
// packages actually shipped inside the extension, and Vite's CJS panel bundle target makes
// bundling a third-party package for a handful of MIME boundary lines more trouble than it's
// worth. This does exactly what `form-data` does for our two field types (text + one file).

interface MultipartField {
  name: string;
  value: string;
}

interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

const buildMultipartBody = (
  fields: MultipartField[],
  file: MultipartFile
): { body: Buffer; boundary: string } => {
  const boundary = `----GroqCaptions${crypto.randomBytes(16).toString("hex")}`;
  const chunks: Buffer[] = [];
  const push = (s: string) => chunks.push(Buffer.from(s, "utf8"));

  for (const field of fields) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`);
    push(`${field.value}\r\n`);
  }

  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`
  );
  push(`Content-Type: ${file.contentType}\r\n\r\n`);
  chunks.push(file.data);
  push(`\r\n--${boundary}--\r\n`);

  return { body: Buffer.concat(chunks), boundary };
};

// Groq verbose_json -> flat word list. Falls back to spreading words evenly across each
// segment when word-level timestamps aren't returned (ported from the ScriptUI prototype).


export interface TranscribeOptions {
  apiKey: string;
  model: GroqModel;
  language?: string;
  prompt?: string;
  /** Retries left on HTTP 429 before giving up. */
  maxRetries?: number;
  /** Maximum wall-clock duration for one transcription HTTP request. Defaults to 120 seconds. */
  timeoutMs?: number;
}

export interface TranscribeHandle {
  promise: Promise<TranscriptResult>;
  cancel: () => void;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 120_000;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const postOnce = (
  filePath: string,
  opts: TranscribeOptions,
  onRequest: (req: any) => void
): Promise<{ status: number; body: string; retryAfterMs: number | null }> => {
  return new Promise((resolve, reject) => {
    const fields: MultipartField[] = [
      { name: "model", value: opts.model },
      { name: "response_format", value: "verbose_json" },
      { name: "timestamp_granularities[]", value: "word" },
      { name: "timestamp_granularities[]", value: "segment" },
      { name: "temperature", value: "0" },
    ];
    if (opts.language) fields.push({ name: "language", value: opts.language });
    if (opts.prompt) fields.push({ name: "prompt", value: opts.prompt });

    const { body, boundary } = buildMultipartBody(fields, {
      name: "file",
      filename: safeUploadFilename(filePath),
      contentType: "application/octet-stream",
      data: fs.readFileSync(filePath),
    });

    const timeoutMs =
      opts.timeoutMs != null && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearRequestTimeout = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const url = new URL(GROQ_TRANSCRIPTION_URL);
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Authorization: `Bearer ${opts.apiKey}`,
        },
      },
      (res: any) => {
        let responseBody = "";
        res.on("data", (chunk: Buffer) => (responseBody += chunk));
        res.on("end", () => {
          clearRequestTimeout();
          const retryAfterHeader = res.headers["retry-after"];
          const retryAfterSeconds =
            retryAfterHeader == null ? Number.NaN : Number(retryAfterHeader);
          const retryAfterMs =
            Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
              ? retryAfterSeconds * 1000
              : null;
          resolve({ status: res.statusCode || 0, body: responseBody, retryAfterMs });
        });
        res.on("error", (err: Error) => {
          clearRequestTimeout();
          reject(err);
        });
      }
    );

    timeout = setTimeout(() => {
      req.destroy(
        new Error(`Groq transcription request timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
      );
    }, timeoutMs);

    req.on("error", (err: Error) => {
      clearRequestTimeout();
      reject(err);
    });
    onRequest(req);
    req.write(body);
    req.end();
  });
};

/** Calls Groq's Whisper transcription endpoint and normalizes the result to a flat word list.
 * Retries on HTTP 429 with exponential backoff (honoring Retry-After when present); every
 * other failure surfaces a message the panel can show as-is. */
export const transcribe = (filePath: string, opts: TranscribeOptions): TranscribeHandle => {
  assertNodeAvailable();
  let cancelled = false;
  let activeReq: any = null;
  let activeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveRetryDelay: (() => void) | null = null;

  const waitForRetry = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (cancelled) {
        resolve();
        return;
      }
      resolveRetryDelay = resolve;
      activeRetryTimer = setTimeout(() => {
        activeRetryTimer = null;
        resolveRetryDelay = null;
        resolve();
      }, ms);
    });

  const run = async (): Promise<TranscriptResult> => {
    const maxRetries = opts.maxRetries ?? 3;
    let attempt = 0;
    while (true) {
      if (cancelled) throw new Error("Cancelled.");
      let result;
      try {
        result = await postOnce(filePath, opts, (req) => (activeReq = req));
      } catch (err) {
        if (cancelled) throw new Error("Cancelled.");
        throw new Error(`Could not reach Groq. Check your internet connection.\n${(err as Error).message}`);
      }
      activeReq = null;
      if (cancelled) throw new Error("Cancelled.");

      if (result.status === 429 && attempt < maxRetries) {
        const backoffMs = computeRetryDelayMs(
          attempt,
          result.retryAfterMs,
          DEFAULT_RETRY_DELAY_MS,
          MAX_RETRY_DELAY_MS
        );
        if (backoffMs !== null) {
          attempt++;
          await waitForRetry(backoffMs);
          continue;
        }
      }

      let parsed: any;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        throw new Error(`Unexpected answer from Groq:\n${result.body.slice(0, 400)}`);
      }

      if (result.status < 200 || result.status >= 300) {
        let message = parsed?.error?.message || `Groq error ${result.status}`;
        if (/api key/i.test(message)) {
          message += "\n\nYour API key is invalid or revoked. Paste a new one in Settings.";
        }
        if (result.status === 429) {
          message += "\n\nRate limit reached. Wait before trying again.";
          if (result.retryAfterMs !== null && result.retryAfterMs > MAX_RETRY_DELAY_MS) {
            message += "\nThe server requested a longer wait than the automatic retry window; the app did not retry early.";
          }
        }
        throw new Error(message);
      }

      return {
        text: parsed.text || "",
        language: parsed.language,
        duration: parsed.duration,
        words: normalizeTranscriptWords(parsed),
        segments: parsed.segments || [],
      };
    }
  };

  return {
    promise: run(),
    cancel: () => {
      cancelled = true;
      if (activeRetryTimer !== null) {
        clearTimeout(activeRetryTimer);
        activeRetryTimer = null;
      }
      const resumeRetry = resolveRetryDelay;
      resolveRetryDelay = null;
      resumeRetry?.();
      try {
        activeReq?.destroy(new Error("Cancelled."));
      } catch {
        // already finished
      }
    },
  };
};
