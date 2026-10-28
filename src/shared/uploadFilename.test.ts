import { describe, expect, it } from "vitest";
import { safeUploadFilename } from "./uploadFilename";

describe("safeUploadFilename", () => {
  it("preserves a safe extension but replaces the user-controlled basename", () => {
    expect(safeUploadFilename("C:\\Media\\voice final.m4a")).toBe("audio.m4a");
    expect(safeUploadFilename("/Users/editor/take.wav")).toBe("audio.wav");
  });

  it("does not allow quotes or line breaks into multipart headers", () => {
    expect(safeUploadFilename('C:\\Media\\bad\"name\r\nContent-Type: text/plain.wav')).toBe("audio.wav");
    expect(safeUploadFilename("audio.flac\r\n--boundary")).toBe("audio");
  });
});
