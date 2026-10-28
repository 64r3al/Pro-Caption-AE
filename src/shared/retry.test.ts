import { describe, expect, it } from "vitest";
import { computeRetryDelayMs } from "./retry";

describe("computeRetryDelayMs", () => {
  it("uses exponential backoff when the server supplies no Retry-After value", () => {
    expect(computeRetryDelayMs(0, null)).toBe(1000);
    expect(computeRetryDelayMs(1, null)).toBe(2000);
    expect(computeRetryDelayMs(2, null)).toBe(4000);
  });

  it("honors a valid Retry-After value within the bounded retry window", () => {
    expect(computeRetryDelayMs(0, 2500)).toBe(2500);
    expect(computeRetryDelayMs(0, 0)).toBe(0);
  });

  it("does not retry earlier than a server-requested wait longer than the allowed window", () => {
    expect(computeRetryDelayMs(0, 120001)).toBeNull();
  });

  it("caps exponential backoff and handles invalid numeric options safely", () => {
    expect(computeRetryDelayMs(99, null)).toBe(120000);
    expect(computeRetryDelayMs(Number.NaN, null, Number.NaN, Number.NaN)).toBe(1000);
    expect(computeRetryDelayMs(-1, null)).toBe(1000);
  });
});
