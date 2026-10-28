export interface WaveformPreviewProps {
  /** Peak-normalized waveform heights, generated from the selected audio. */
  heights: number[];
  className?: string;
}

export const WaveformPreview = ({ heights, className }: WaveformPreviewProps) => {
  if (!heights.length) {
    return <div className={`gc-waveform ${className || ""}`} aria-label="No waveform data available" />;
  }

  return (
    <div className={`gc-waveform ${className || ""}`} aria-label="Audio waveform">
      {heights.map((height, index) => (
        <span
          key={index}
          className="gc-waveform-bar"
          style={{ height: `${Math.max(6, Math.min(100, height))}%` }}
        />
      ))}
    </div>
  );
};
