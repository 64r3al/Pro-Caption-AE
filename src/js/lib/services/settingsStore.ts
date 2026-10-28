import { crypto, fs, path } from "../cep/node";
import { assertNodeAvailable, getAppSettingsDir } from "./env";

// Settings are stored as JSON on disk, with the API key encrypted at rest (AES-256-GCM) using
// a random key generated on first run and kept in a sibling file with owner-only permissions.
// This is BYOK convenience, not a hardware-backed secret store: anyone with local admin/root
// access to this machine could still recover it. A real OS keychain (Keychain Access on macOS,
// Credential Manager on Windows) would be a stronger Phase 5 upgrade; see docs/ARCHITECTURE.md.

interface EncryptedBlob {
  iv: string;
  tag: string;
  data: string;
}

interface StoredSettings {
  apiKey?: EncryptedBlob;
  ffmpegPath?: string;
}

const SETTINGS_FILE = "settings.json";
const KEY_FILE = "local.key";

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

const getLocalKey = (): Buffer => {
  const dir = getAppSettingsDir();
  ensureDir(dir);
  const keyPath = path.join(dir, KEY_FILE);
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
};

const readSettings = (): StoredSettings => {
  assertNodeAvailable();
  const file = path.join(getAppSettingsDir(), SETTINGS_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, { encoding: "utf-8" }));
  } catch {
    return {};
  }
};

const writeSettings = (settings: StoredSettings): void => {
  assertNodeAvailable();
  const dir = getAppSettingsDir();
  ensureDir(dir);
  const file = path.join(dir, SETTINGS_FILE);
  const temporaryFile = path.join(dir, SETTINGS_FILE + "." + Date.now() + ".tmp");
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
};

const encrypt = (plain: string): EncryptedBlob => {
  const key = getLocalKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
};

const decrypt = (blob: EncryptedBlob): string => {
  const key = getLocalKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const data = Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]);
  return data.toString("utf8");
};

export const getStoredApiKey = (): string | null => {
  if (typeof window !== "undefined" && typeof window.cep === "undefined") {
    try {
      return localStorage.getItem("groq_captions_api_key") || null;
    } catch {
      return null;
    }
  }
  try {
    const settings = readSettings();
    if (!settings.apiKey) return null;
    return decrypt(settings.apiKey);
  } catch {
    // Key file and settings file got out of sync or Node unavailable.
    return null;
  }
};

export const setStoredApiKey = (apiKey: string): void => {
  if (typeof window !== "undefined" && typeof window.cep === "undefined") {
    try {
      if (apiKey) {
        localStorage.setItem("groq_captions_api_key", apiKey);
      } else {
        localStorage.removeItem("groq_captions_api_key");
      }
    } catch {}
    return;
  }
  const settings = readSettings();
  if (apiKey) {
    settings.apiKey = encrypt(apiKey);
  } else {
    delete settings.apiKey;
  }
  writeSettings(settings);
};

export const getStoredFfmpegPath = (): string | null => {
  if (typeof window !== "undefined" && typeof window.cep === "undefined") {
    try {
      return localStorage.getItem("groq_captions_ffmpeg_path") || null;
    } catch {
      return null;
    }
  }
  try {
    return readSettings().ffmpegPath || null;
  } catch {
    return null;
  }
};

export const setStoredFfmpegPath = (ffmpegPath: string | null): void => {
  if (typeof window !== "undefined" && typeof window.cep === "undefined") {
    try {
      if (ffmpegPath) {
        localStorage.setItem("groq_captions_ffmpeg_path", ffmpegPath);
      } else {
        localStorage.removeItem("groq_captions_ffmpeg_path");
      }
    } catch {}
    return;
  }
  const settings = readSettings();
  if (ffmpegPath) {
    settings.ffmpegPath = ffmpegPath;
  } else {
    delete settings.ffmpegPath;
  }
  writeSettings(settings);
};
