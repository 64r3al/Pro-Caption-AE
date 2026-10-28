import { useEffect, useState } from "react";
import { Check, FolderSearch, KeyRound } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { resolveApiKey, saveApiKey, clearStoredApiKey, testApiKey } from "../../lib/services/apiKey";
import { findFfmpeg, setFfmpegOverride } from "../../lib/services/ffmpeg";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { InlineError } from "../ui/InlineError";
import type { ApiKeyStatus } from "../../../shared/types";

const sourceLabel = (status: ApiKeyStatus): string => {
  if (status.source === "settings") return `Using saved key (…${status.last4})`;
  if (status.source === "env") return `Using GROQ_API_KEY from .env.local (…${status.last4})`;
  return "No API key configured yet.";
};

export const SettingsTab = () => {
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<ApiKeyStatus>({ source: "none", last4: "" });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [locatingFfmpeg, setLocatingFfmpeg] = useState(false);
  const [ffmpegPath, setFfmpegPath] = useState<string | null>(null);

  const refresh = async () => {
    // Node integration (fs/child_process) isn't present in the plain-browser `npm run dev`
    // server - resolveApiKey()/findFfmpeg() throw a clear "Node.js integration isn't
    // available" error there (see lib/services/env.ts#assertNodeAvailable). Inside After
    // Effects this never throws, so this only ever renders the "not configured" fallback
    // state in browser dev, never masking a real failure.
    try {
      const { status } = resolveApiKey();
      setStatus(status);
      setFfmpegPath(await findFfmpeg());
    } catch {
      setStatus({ source: "none", last4: "" });
      setFfmpegPath(null);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleSave = () => {
    if (!keyInput.trim()) return;
    setSettingsError(null);
    try {
      saveApiKey(keyInput.trim());
      setKeyInput("");
      setTestResult(null);
      void refresh();
    } catch (err: any) {
      setSettingsError(err?.message || "Could not save the API key. Check file permissions and try again.");
    }
  };

  const handleClear = () => {
    setSettingsError(null);
    try {
      clearStoredApiKey();
      setTestResult(null);
      void refresh();
    } catch (err: any) {
      setSettingsError(err?.message || "Could not clear the saved API key. Try again.");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { key } = resolveApiKey();
      const candidate = keyInput.trim() || key;
      if (!candidate) {
        setTestResult({ ok: false, message: "Enter an API key first." });
        return;
      }
      const result = await testApiKey(candidate);
      setTestResult({ ok: result.ok, message: result.message });
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || "Could not test the API key. Check the extension settings and try again.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleLocateFfmpeg = async () => {
    setSettingsError(null);
    setLocatingFfmpeg(true);
    try {
      const picked = await evalTS("pickFfmpegExecutable");
      if (picked) {
        setFfmpegOverride(picked);
        setFfmpegPath(picked);
      }
    } catch (err: any) {
      setSettingsError(err?.message || "Could not save the FFmpeg location. Check permissions and try again.");
    } finally {
      setLocatingFfmpeg(false);
    }
  };

  return (
    <div className="gc-pane">
      <section className="gc-pane">
        <h3 className="gc-section-header-title">Groq API key</h3>
        <p className="gc-hint">{sourceLabel(status)}</p>
        <Input
          type="password"
          placeholder="gsk_..."
          icon={<KeyRound size={14} />}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <div className="gc-toggle-row">
          <Button size="sm" onClick={handleSave} disabled={!keyInput.trim()}>
            Save key
          </Button>
          <Button size="sm" variant="secondary" onClick={handleTest} loading={testing}>
            Test key
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClear} disabled={status.source !== "settings"}>
            Clear saved key
          </Button>
        </div>
        {testResult && !testResult.ok && <InlineError message={testResult.message} />}
        {settingsError && <InlineError message={settingsError} />}
        {testResult?.ok && (
          <p className="gc-hint gc-settings-success">
            <Check size={12} /> {testResult.message}
          </p>
        )}
        <p className="gc-hint">
          Keys are stored encrypted in your OS user profile, never in this project's files. A
          key can also be provided via a local-only .env.local (GROQ_API_KEY=...) during
          development; a saved key here always takes priority.
        </p>
      </section>

      <section className="gc-pane">
        <h3 className="gc-section-header-title">ffmpeg</h3>
        {ffmpegPath ? (
          <p className="gc-hint">Found: {ffmpegPath}</p>
        ) : (
          <InlineError
            variant="warning"
            message="Not found. Without ffmpeg, only short clips (≤25 MB, mp3/mp4/wav/m4a/flac/ogg/webm) can be sent directly to Groq."
          />
        )}
        <Button size="sm" variant="secondary" icon={<FolderSearch size={14} />} onClick={handleLocateFfmpeg} loading={locatingFfmpeg}>
          Locate ffmpeg…
        </Button>
      </section>
    </div>
  );
};
