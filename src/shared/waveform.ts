/**
 * Compresses normalized audio sample magnitudes into a bounded set of peak bars.
 * Input values are expected in [-1, 1]; invalid samples are ignored.
 */
export const compressWaveformSamples = (
  samples: readonly number[],
  requestedBars = 64
): number[] => {
  if (!samples.length || !Number.isFinite(requestedBars) || requestedBars < 1) return [];
  const targetBars = Math.min(160, Math.max(1, Math.floor(requestedBars)));
  const count = Math.min(targetBars, samples.length);
  const heights: number[] = [];

  for (let bar = 0; bar < count; bar++) {
    const start = Math.floor((bar * samples.length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * samples.length) / count));
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
      const value = samples[sampleIndex];
      if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, Math.abs(value)));
    }
    heights.push(Math.max(6, Math.round(peak * 100)));
  }

  return heights;
};
