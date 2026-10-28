import { describe, expect, it } from "vitest";
import { isArabicLanguage } from "./languages";

describe("isArabicLanguage", () => {
  it("recognizes Arabic language codes and names", () => {
    expect(isArabicLanguage("ar")).toBe(true);
    expect(isArabicLanguage("AR")).toBe(true);
    expect(isArabicLanguage("arabic")).toBe(true);
    expect(isArabicLanguage("ar-DZ")).toBe(true);
    expect(isArabicLanguage("ar_DZ")).toBe(true);
  });

  it("does not classify unrelated or missing language values as Arabic", () => {
    expect(isArabicLanguage("en")).toBe(false);
    expect(isArabicLanguage("French")).toBe(false);
    expect(isArabicLanguage("")).toBe(false);
    expect(isArabicLanguage(null)).toBe(false);
  });
});
