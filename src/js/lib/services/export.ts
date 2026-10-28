import { fs } from "../cep/node";
import { assertNodeAvailable } from "./env";

/** Writes user-requested export content to the path returned by After Effects' save dialog. */
export const writeExportFile = (filePath: string, contents: string): void => {
  assertNodeAvailable();
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Choose a valid destination path before exporting.");
  }
  if (typeof contents !== "string") {
    throw new Error("Export content must be text.");
  }
  fs.writeFileSync(filePath, contents, { encoding: "utf8" });
};
