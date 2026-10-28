import { useEffect, useRef, useState } from "react";
import { useElementWidth, useInView, intToHex } from "../ui";
import { POSITION_Y_FRACTIONS } from "../../../shared/constants";
import type { CaptionStyle } from "../../../shared/types";

export interface CaptionPreviewCanvasProps {
  style: Omit<CaptionStyle, "leadInFrames">;
}

const SAMPLE_WORDS = ["Add", "captions", "that", "actually", "pop"];
// The style's `size` is tuned for a ~1920px-wide comp (see DEFAULT_CAPTION_STYLE) - scale the
// preview's sample text against that same reference so it looks like what buildCaptions would
// actually produce, not an arbitrary preview-only size.
const REFERENCE_COMP_WIDTH = 1920;
const WORD_INTERVAL_MS = 650;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Live preview of the current caption style, cycling through a short sample sentence to show
 * reveal/highlight/pop/shadow the way they'd actually look once built in After Effects. Only
 * animates while the frame is in view (useInView) and never touches AE - this is the "most
 * important visual feature" of the Style tab per the redesign brief, so it needs to update
 * instantly on every control change with no host round-trip. */
export const CaptionPreviewCanvas = ({ style }: CaptionPreviewCanvasProps) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef);
  const frameWidth = useElementWidth(frameRef);
  const [activeIndex, setActiveIndex] = useState(0);
  const isStatic = style.staticAnimation === true;

  useEffect(() => {
    if (isStatic || !inView || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % SAMPLE_WORDS.length);
    }, WORD_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [inView, isStatic]);

  const scale = frameWidth ? frameWidth / REFERENCE_COMP_WIDTH : 0;
  const fontSize = style.size * scale;
  const strokeWidth = style.strokeWidth * scale;
  const topPercent = POSITION_Y_FRACTIONS[style.posIndex] * 100;

  const visibleWords = !isStatic && style.reveal ? SAMPLE_WORDS.slice(0, activeIndex + 1) : SAMPLE_WORDS;

  return (
    <div className="gc-preview-frame" ref={frameRef}>
      <div className="gc-preview-caption-row" style={{ top: `${topPercent}%` }}>
        {visibleWords.map((word, i) => {
          const isActive = !isStatic && i === activeIndex;
          return (
            <span
              key={`${word}-${i}`}
              className={`gc-preview-word${isActive && style.pop ? " gc-preview-word--pop" : ""}`}
              style={{
                fontSize: fontSize ? `${fontSize}px` : undefined,
                color: intToHex(isActive && style.highlight ? style.highlightColor : style.textColor),
                WebkitTextStroke: strokeWidth ? `${strokeWidth}px ${intToHex(style.strokeColor)}` : undefined,
                textShadow: style.shadow ? "0 4px 10px rgba(0, 0, 0, 0.6)" : undefined,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
