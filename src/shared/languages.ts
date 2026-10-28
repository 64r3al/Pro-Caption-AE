/** Language-specific presentation helpers shared by transcript and caption workflows. */
export const isArabicLanguage = (value: string | null | undefined): boolean => {
  const normalized = (value || "").replace(/^\s+|\s+$/g, "").toLowerCase();
  return normalized === "ar" || normalized === "arabic" || /^ar[-_]/.test(normalized);
};
