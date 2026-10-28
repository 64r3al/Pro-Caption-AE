import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Plus, Trash2, X } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import type { TranscriptWord } from "../../../shared/types";

export interface TranscriptEditorProps {
  words: TranscriptWord[];
  onChange: (words: TranscriptWord[]) => void;
  onSelectWord?: (index: number) => void;
  activeWordIndex?: number;
  disabled?: boolean;
}

interface IndexedWord {
  index: number;
  word: TranscriptWord;
}

const DISPLAY_CHUNK_SIZE = 8;
const SENTENCE_END = /[.!?…]$/;

const fmtTimestamp = (n: number): string => {
  const safe = Math.max(0, Number.isFinite(n) ? n : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = (safe % 60).toFixed(1);
  return `${minutes}:${seconds.padStart(4, "0")}`;
};

const chunkForDisplay = (words: TranscriptWord[]): IndexedWord[][] => {
  const rows: IndexedWord[][] = [];
  let current: IndexedWord[] = [];
  words.forEach((word, index) => {
    current.push({ word, index });
    if (current.length >= DISPLAY_CHUNK_SIZE || SENTENCE_END.test(word.text)) {
      rows.push(current);
      current = [];
    }
  });
  if (current.length) rows.push(current);
  return rows;
};

export const TranscriptEditor = ({
  words,
  onChange,
  onSelectWord,
  activeWordIndex = -1,
  disabled = false,
}: TranscriptEditorProps) => {
  const rows = useMemo(() => chunkForDisplay(words), [words]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [newWordText, setNewWordText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= words.length) {
      setSelectedIndex(null);
      setDraftText("");
      setDraftStart("");
      setDraftEnd("");
      setError(null);
    }
  }, [selectedIndex, words.length]);

  const selectWord = (index: number) => {
    const word = words[index];
    if (!word) return;
    setSelectedIndex(index);
    setDraftText(word.text);
    setDraftStart(String(word.start));
    setDraftEnd(String(word.end));
    setError(null);
    onSelectWord?.(index);
  };

  const saveWord = () => {
    if (disabled || selectedIndex == null) return;
    const text = draftText.trim();
    const start = Number(draftStart);
    const end = Number(draftEnd);
    if (!text) {
      setError("Word text cannot be empty.");
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      setError("Enter valid times. Start must be non-negative and end must not precede start.");
      return;
    }
    if (selectedIndex > 0 && start < words[selectedIndex - 1].start) {
      setError("This word cannot start before the preceding word.");
      return;
    }
    if (selectedIndex < words.length - 1 && start > words[selectedIndex + 1].start) {
      setError("This word cannot start after the following word.");
      return;
    }
    onChange(words.map((word, index) => index === selectedIndex ? { text, start, end } : word));
    setDraftText(text);
    setDraftStart(String(start));
    setDraftEnd(String(end));
    setError(null);
  };

  const deleteWord = () => {
    if (disabled || selectedIndex == null) return;
    if (words.length <= 1) {
      setError("Keep at least one word in the transcript. Replace its text to remove the last word.");
      return;
    }
    const nextWords = words.filter((_word, index) => index !== selectedIndex);
    onChange(nextWords);
    setSelectedIndex(null);
    setDraftText("");
    setDraftStart("");
    setDraftEnd("");
    setError(null);
  };

  const addWord = () => {
    if (disabled) return;
    const text = newWordText.trim();
    if (!text) {
      setError("Enter the word or short phrase to insert.");
      return;
    }
    const insertAt = selectedIndex == null ? words.length : selectedIndex + 1;
    const previous = insertAt > 0 ? words[insertAt - 1] : null;
    const next = insertAt < words.length ? words[insertAt] : null;
    const start = previous && next
      ? previous.start + Math.max(0, next.start - previous.start) / 2
      : previous
        ? previous.end
        : 0;
    const end = next ? Math.max(start, next.start) : start + 0.2;
    const nextWords = [
      ...words.slice(0, insertAt),
      { text, start, end },
      ...words.slice(insertAt),
    ];
    onChange(nextWords);
    setNewWordText("");
    setSelectedIndex(insertAt);
    setDraftText(text);
    setDraftStart(String(start));
    setDraftEnd(String(end));
    setError(null);
  };

  if (!rows.length) {
    return (
      <EmptyState
        icon={<FileText size={24} />}
        title="No transcript yet"
        description="Transcribe a selected audio layer to edit words and timings here."
      />
    );
  }

  return (
    <div className="gc-transcript-editor">
      <div className="gc-transcript" aria-label="Transcript words">
        {rows.map((row, rowIndex) => (
          <div className="gc-transcript-row" key={rowIndex}>
            <span className="gc-transcript-time gc-num">{fmtTimestamp(row[0].word.start)}</span>
            <span className="gc-transcript-words">
              {row.map(({ word, index }) => (
                <button
                  type="button"
                  className={`gc-transcript-chip${index === activeWordIndex ? " gc-transcript-chip--active" : ""}${index === selectedIndex ? " gc-transcript-chip--selected" : ""}`}
                  key={`${index}-${word.start}-${word.text}`}
                  onClick={() => selectWord(index)}
                  disabled={disabled}
                  aria-pressed={index === selectedIndex}
                  title={`Select word at ${word.start.toFixed(3)} seconds`}
                >
                  {word.text}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="gc-transcript-tools">
        <div className="gc-transcript-tools-heading">
          <strong>{selectedIndex == null ? "Edit a word" : `Selected word · ${selectedIndex + 1} of ${words.length}`}</strong>
          <span>Times are relative to the selected layer's audio range.</span>
        </div>

        {selectedIndex != null && words[selectedIndex] && (
          <div className="gc-transcript-edit-form">
            <label>
              <span>Text</span>
              <input
                type="text"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                disabled={disabled}
                maxLength={300}
              />
            </label>
            <label>
              <span>Start (s)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={draftStart}
                onChange={(event) => setDraftStart(event.target.value)}
                disabled={disabled}
              />
            </label>
            <label>
              <span>End (s)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={draftEnd}
                onChange={(event) => setDraftEnd(event.target.value)}
                disabled={disabled}
              />
            </label>
            <div className="gc-transcript-edit-actions">
              <button type="button" onClick={saveWord} disabled={disabled} title="Save word correction">
                <Check size={13} /> Save
              </button>
              <button type="button" onClick={deleteWord} disabled={disabled} title="Delete selected word">
                <Trash2 size={13} /> Delete
              </button>
              <button type="button" onClick={() => { setSelectedIndex(null); setError(null); }} disabled={disabled} title="Close editor">
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="gc-transcript-add-form">
          <input
            type="text"
            value={newWordText}
            onChange={(event) => setNewWordText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addWord(); }}
            placeholder={selectedIndex == null ? "Add a word at the end…" : "Insert a word after the selected word…"}
            disabled={disabled}
            maxLength={300}
          />
          <button type="button" onClick={addWord} disabled={disabled || !newWordText.trim()}>
            <Plus size={13} /> Insert
          </button>
        </div>
        {error && <p className="gc-transcript-error" role="alert">{error}</p>}
      </div>
    </div>
  );
};
