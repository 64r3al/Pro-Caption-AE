/** Returns a MIME header-safe filename while retaining a simple format extension for Groq. */
export const safeUploadFilename = (filePath: string): string => {
  const basename = String(filePath || "").split(/[\\/]/).pop() || "";
  const extension = basename.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
  return extension ? `audio.${extension}` : "audio";
};
