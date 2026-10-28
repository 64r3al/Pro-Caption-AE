// Dev-only showcase of every ui/ primitive and features/ component in its various states, for
// visual QA (Playwright screenshots at 300px/480px) without needing After Effects running.
// Reached via `npm run dev` + `?gallery=1` - see index-react.tsx. Never shipped to the
// packaged extension (see that file for why).
import { useState } from "react";
import {
  Wand2,
  Download,
  Trash2,
  Search,
  RefreshCw,
  Settings as SettingsIcon,
  FileAudio,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CollapsibleSection,
  ColorSwatch,
  EmptyState,
  InlineError,
  Input,
  NumberScrubber,
  Progress,
  SectionHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StagedProgress,
  Textarea,
  Toggle,
  Tooltip,
  ToastProvider,
  useToast,
} from "../ui";
import { CaptionPreviewCanvas, CAPTION_STYLE_PRESETS, PresetGallery, StatusPill, TranscriptEditor, WaveformPreview } from "../features";
import { DEFAULT_CAPTION_STYLE } from "../../../shared/constants";
import type { CaptionStyle, TranscriptWord } from "../../../shared/types";
import "./gallery.scss";

// Presets are matched back to their id by object reference, purely so the gallery can outline
// the active preset card - a gallery-only convenience, not something the real Style tab needs
// (it just applies the style directly and doesn't track which preset produced it).
const presetIdForStyle = (style: Omit<CaptionStyle, "leadInFrames">): string | null =>
  CAPTION_STYLE_PRESETS.find((p) => p.style === style)?.id ?? null;

const MOCK_WORDS: TranscriptWord[] = (
  "add captions that actually pop, with word by word timing pulled straight from the audio. " +
  "no more manually typing out every single line by hand, ever again."
)
  .split(" ")
  .map((text, i) => ({ text, start: i * 0.32, end: i * 0.32 + 0.28 }));

const ToastDemoButtons = () => {
  const { show } = useToast();
  return (
    <div className="gc-gallery-row">
      <Button size="sm" onClick={() => show({ title: "Captions built", description: "12 captions, 84 words.", variant: "success" })}>
        Success toast
      </Button>
      <Button size="sm" onClick={() => show({ title: "Transcription failed", description: "Check your API key.", variant: "error" })}>
        Error toast
      </Button>
      <Button size="sm" onClick={() => show({ title: "ffmpeg not found", variant: "info" })}>
        Info toast
      </Button>
    </div>
  );
};

const GallerySection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="gc-gallery-section">
    <h2 className="gc-gallery-heading">{title}</h2>
    <div className="gc-gallery-body">{children}</div>
  </section>
);

export const UIGallery = () => {
  const [text, setText] = useState("");
  const [select, setSelect] = useState("a");
  const [segment, setSegment] = useState("one");
  const [toggle, setToggle] = useState(true);
  const [scrub, setScrub] = useState(90);
  const [color, setColor] = useState(0xffd400);
  const [progress, setProgress] = useState(42);
  const [collapsed, setCollapsed] = useState(false);
  const [style, setStyle] = useState<Omit<CaptionStyle, "leadInFrames">>(DEFAULT_CAPTION_STYLE);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  return (
    <ToastProvider>
      <div className="gc-gallery">
        <header className="gc-gallery-header">
          <h1>Pro Caption AE — UI Gallery</h1>
          <div className="gc-gallery-row">
            <StatusPill label="Layer selected" tone="success" />
            <StatusPill label="No API key" tone="warning" />
            <StatusPill label="ffmpeg missing" tone="danger" />
            <StatusPill label="Idle" tone="neutral" />
          </div>
        </header>

        <GallerySection title="Buttons">
          <div className="gc-gallery-row">
            <Button variant="primary" icon={<Wand2 size={14} />}>Generate</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 size={14} />}>Delete</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="secondary" iconOnly aria-label="Settings" icon={<SettingsIcon size={14} />} />
          </div>
        </GallerySection>

        <GallerySection title="Inputs">
          <div className="gc-gallery-row">
            <Input label="Vocabulary" placeholder="Names, brands, slang…" icon={<Search size={14} />} value={text} onChange={(e) => setText(e.target.value)} />
            <Input label="With error" error defaultValue="gsk_invalid" />
            <Select
              label="Model"
              value={select}
              onChange={(e) => setSelect(e.target.value)}
              options={[
                { value: "a", label: "Whisper Large v3" },
                { value: "b", label: "Whisper Large v3 Turbo" },
              ]}
            />
          </div>
          <Textarea label="Notes" placeholder="Multi-line…" rows={3} />
        </GallerySection>

        <GallerySection title="Segmented control / Toggle / Scrubber">
          <div className="gc-gallery-row">
            <SegmentedControl
              value={segment}
              onChange={setSegment}
              options={[
                { value: "one", label: "Bottom" },
                { value: "two", label: "Center" },
                { value: "three", label: "Top" },
              ]}
            />
            <Toggle checked={toggle} onChange={setToggle} label="Word-by-word reveal" />
            <NumberScrubber label="Size" value={scrub} onChange={setScrub} min={4} max={300} suffix="px" />
          </div>
        </GallerySection>

        <GallerySection title="Color swatch / Tooltip">
          <div className="gc-gallery-row">
            <ColorSwatch label="Highlight" value={color} onChange={setColor} />
            <Tooltip content="Refine word timing against the audio's energy envelope">
              <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />}>
                Hover for tooltip
              </Button>
            </Tooltip>
          </div>
        </GallerySection>

        <GallerySection title="Toast">
          <ToastDemoButtons />
        </GallerySection>

        <GallerySection title="Progress">
          <div className="gc-gallery-col">
            <Progress value={progress} aria-label="Upload progress" />
            <div className="gc-gallery-row">
              <Button size="sm" onClick={() => setProgress((p) => Math.max(0, p - 10))}>-10</Button>
              <Button size="sm" onClick={() => setProgress((p) => Math.min(100, p + 10))}>+10</Button>
            </div>
            <Progress aria-label="Indeterminate" />
            <StagedProgress
              steps={[
                { key: "extract", label: "Extracting" },
                { key: "transcribe", label: "Transcribing" },
                { key: "sync", label: "Syncing" },
                { key: "build", label: "Building" },
              ]}
              activeKey="transcribe"
            />
          </div>
        </GallerySection>

        <GallerySection title="Skeleton / Empty state / Inline error">
          <div className="gc-gallery-col">
            <Skeleton height={14} width="60%" />
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="40%" />
          </div>
          <EmptyState
            icon={<FileAudio size={24} />}
            title="No audio layer selected"
            description="Select a layer with audio in After Effects, then refresh."
            action={<Button size="sm" icon={<RefreshCw size={14} />}>Refresh</Button>}
          />
          <InlineError message="Add your Groq API key in Settings first." />
          <InlineError variant="warning" message="ffmpeg was not found - only short clips can be sent directly to Groq." />
        </GallerySection>

        <GallerySection title="Card / SectionHeader / Badge">
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <SectionHeader title="Static header" subtitle="Not collapsible" />
          </Card>
          <CollapsibleSection
            title="Collapsible section"
            subtitle="Click to toggle"
            open={!collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            action={<Badge variant="accent">3</Badge>}
          >
            <p>Body content revealed while open.</p>
          </CollapsibleSection>
          <div className="gc-gallery-row" style={{ marginTop: 12 }}>
            <Badge>Default</Badge>
            <Badge variant="success" dot>Ready</Badge>
            <Badge variant="warning" dot>Pending</Badge>
            <Badge variant="danger" dot>Failed</Badge>
            <Badge variant="accent">New</Badge>
          </div>
        </GallerySection>

        <GallerySection title="Waveform preview (sample data)">
          <WaveformPreview heights={[12, 22, 18, 65, 80, 34, 45, 98, 72, 40, 28, 60, 16, 22, 85, 56]} />
        </GallerySection>

        <GallerySection title="Caption preview canvas">
          <div className="gc-gallery-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <CaptionPreviewCanvas style={style} />
            </div>
            <div className="gc-gallery-col" style={{ minWidth: 160 }}>
              <Toggle checked={style.reveal} onChange={(v) => setStyle((s) => ({ ...s, reveal: v }))} label="Reveal" />
              <Toggle checked={style.highlight} onChange={(v) => setStyle((s) => ({ ...s, highlight: v }))} label="Highlight" />
              <Toggle checked={style.pop} onChange={(v) => setStyle((s) => ({ ...s, pop: v }))} label="Pop" />
              <Toggle checked={style.shadow} onChange={(v) => setStyle((s) => ({ ...s, shadow: v }))} label="Shadow" />
            </div>
          </div>
        </GallerySection>

        <GallerySection title="Preset gallery">
          <PresetGallery
            activeId={activePreset}
            onApply={(appliedStyle) => {
              setStyle(appliedStyle);
              setActivePreset(presetIdForStyle(appliedStyle));
            }}
          />
        </GallerySection>

        <GallerySection title="Transcript editor">
          <TranscriptEditor words={MOCK_WORDS} onChange={() => undefined} />
        </GallerySection>
      </div>
    </ToastProvider>
  );
};
