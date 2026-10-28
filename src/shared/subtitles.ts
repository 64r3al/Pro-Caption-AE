import type { CaptionGroupData } from "./types";

export type SubtitleFormat = "srt" | "vtt";

const timestamp = (seconds: number, format: SubtitleFormat): string => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const separator = format === "srt" ? "," : ".";
  const pad = (value: number, size: number) => String(value).padStart(size, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}${separator}${pad(milliseconds, 3)}`;
};

/** Formats valid caption groups as standard SRT or WebVTT without changing their timing. */
export const formatSubtitles = (
  groups: readonly CaptionGroupData[],
  format: SubtitleFormat
): string => {
  const validGroups = groups.filter((group) =>
    !!group &&
    typeof group.text === "string" &&
    !!group.text.trim() &&
    Number.isFinite(group.start) &&
    Number.isFinite(group.end) &&
    group.start >= 0 &&
    group.end > group.start
  );
  const blocks = validGroups.map((group, index) => {
    const start = timestamp(group.start, format);
    const end = timestamp(group.end, format);
    const text = group.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    return format === "srt"
      ? `${index + 1}\n${start} --> ${end}\n${text}`
      : `${start} --> ${end}\n${text}`;
  });
  const header = format === "vtt" ? "WEBVTT\n\n" : "";
  return blocks.length ? header + blocks.join("\n\n") + "\n" : header;
};
