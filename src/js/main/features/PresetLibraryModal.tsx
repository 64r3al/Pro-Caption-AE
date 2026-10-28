import { useState } from "react";
import type { ViralPreset } from "../../../shared/presets";
import type { PresetCategory } from "../../../shared/types";
import { getPresetRenderSupport } from "../../../shared/presetCapabilities";

interface PresetLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePresetId: string;
  presets: ViralPreset[];
  onSelectPreset: (preset: ViralPreset) => void;
}

export const PresetLibraryModal = ({
  isOpen,
  onClose,
  activePresetId,
  presets,
  onSelectPreset,
}: PresetLibraryModalProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  if (!isOpen) return null;

  const categories: (string | PresetCategory)[] = [
    "All",
    "TikTok / Reels / Shorts",
    "YouTube",
    "AMV / Edits",
    "Music Videos / Lyric Videos",
    "Storytelling & Movie",
    "Kinetic Motion",
  ];

  const filteredPresets = presets.filter((p) => {
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      q === "" ||
      p.name.toLowerCase().includes(q) ||
      p.tag.toLowerCase().includes(q) ||
      p.whatItLooksLike.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      `#${p.num}`.includes(q) ||
      `${p.num}` === q;
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-space-sm sm:p-space-lg animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-surface-container rounded-xl shadow-2xl flex flex-col border border-outline-variant/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-space-md py-space-sm bg-surface-container-high border-b border-outline-variant/30">
          <div className="flex items-center gap-space-xs">
            <div className="w-7 h-7 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[18px]">auto_awesome_motion</span>
            </div>
            <div>
              <div className="flex items-center gap-space-xs">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Viral Animation Presets Library
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-primary text-on-primary font-label-xs text-[9px] font-bold">
                  {presets.length} PRESETS
                </span>
              </div>
              <p className="font-label-xs text-label-xs text-on-surface-variant">
                Zero-Delay, Frame-Quantized Expression Text Animators for Adobe After Effects
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
            title="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Search & Category Filter Toolbar */}
        <div className="flex flex-col gap-space-xs p-space-sm bg-surface-container-low border-b border-outline-variant/20">
          {/* Search bar */}
          <div className="relative flex items-center bg-surface-container-lowest px-space-sm py-1.5 rounded-lg border border-outline-variant/30">
            <span className="material-symbols-outlined text-on-surface-variant text-[16px] mr-2">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, number, or style (e.g. #51, Underline, Squash, Star Wars, Neon)..."
              className="bg-transparent text-on-surface text-body-sm font-body-sm w-full outline-none placeholder:text-on-surface-variant/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-on-surface-variant hover:text-on-surface text-[14px] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <p className="text-[10px] leading-relaxed text-on-surface-variant" role="note">
            Preview cards can include illustrative browser-only UI. Render support badges clarify whether a preset currently builds native shapes, native text motion, or a simplified text-based approximation.
          </p>

          {/* Category Chips */}
          <div className="flex flex-wrap items-center gap-space-xs pt-1">
            {categories.map((cat) => {
              const count =
                cat === "All"
                  ? presets.length
                  : presets.filter((p) => p.category === cat).length;
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-space-sm py-1 rounded-md font-label-xs text-label-xs whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? "bg-primary text-on-primary font-bold shadow-sm"
                      : "bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-variant"
                  }`}
                >
                  <span>{cat}</span>
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded-full font-mono ${
                      isActive ? "bg-on-primary/20 text-on-primary" : "bg-surface-container-lowest text-on-surface-variant"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preset Cards Grid (GPU-Accelerated Micro-Previews) */}
        <div className="flex-1 overflow-y-auto p-space-sm sm:p-space-md grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-space-sm">
          {filteredPresets.length === 0 ? (
            <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined text-outline text-[40px] mb-2">style</span>
              <p className="font-headline-xs text-headline-xs text-on-surface font-semibold">No presets matched "{searchQuery}"</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Try searching for keywords like "Rotate", "Glitch", "YouTube", "AMV", or select "All".
              </p>
            </div>
          ) : (
            filteredPresets.map((preset) => {
              const isSelected = activePresetId === preset.id;
              const renderSupport = getPresetRenderSupport(preset.animMode);
              return (
                <div
                  key={preset.id}
                  onClick={() => onSelectPreset(preset)}
                  className={`group relative flex flex-col rounded-xl p-space-sm transition-all cursor-pointer border select-none ${
                    isSelected
                      ? "bg-surface-container-highest border-primary ring-1 ring-primary shadow-lg is-active"
                      : "bg-surface-container-low hover:bg-surface-container-high border-outline-variant/30 hover:border-outline-variant/70 shadow-sm"
                  }`}
                >
                  {/* Visual Preview Box */}
                  <div
                    className={`relative w-full h-24 rounded-lg bg-surface-container-lowest overflow-hidden flex flex-col items-center justify-center p-space-xs bg-gradient-to-br ${preset.previewBgGradient}`}
                  >
                    {/* Background glow orb */}
                    <div
                      className="absolute w-16 h-16 rounded-full blur-xl opacity-25 pointer-events-none"
                      style={{ backgroundColor: preset.highlightColor }}
                    />

                    {/* Number Badge */}
                    <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                      <span className="bg-surface-container-lowest/80 text-on-surface-variant font-mono text-[9px] px-1 py-0.5 rounded">
                        #{preset.num}
                      </span>
                    </div>

                    {/* Tag badge */}
                    <div className="absolute top-2 right-2 z-10">
                      <span className={`font-label-xs text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${preset.accentBadge}`}>
                        {preset.tag}
                      </span>
                    </div>

                    {/* Styled Text Sample with GPU Animation Class */}
                    <div className="relative z-10 flex items-center justify-center gap-1.5 font-black uppercase tracking-tight preset-preview-target">
                      <span
                        style={{
                          color: preset.baseColor,
                          fontSize: "15px",
                          WebkitTextStroke: preset.strokeWidth ? `0.5px ${preset.strokeColor}` : undefined,
                        }}
                      >
                        VIRAL
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded shadow-sm transform transition-transform ${preset.previewStyleClass}`}
                        style={{
                          color: preset.highlightColor,
                          backgroundColor: "#181818",
                          fontSize: "16px",
                          boxShadow: `0 0 10px ${preset.highlightColor}60`,
                          WebkitTextStroke: preset.strokeWidth ? `0.5px ${preset.strokeColor}` : undefined,
                        }}
                      >
                        MOTION
                      </span>
                    </div>

                    {/* Visual Look Subtitle */}
                    <div className="absolute bottom-1.5 inset-x-2 truncate text-center">
                      <span className="font-label-xs text-[8.5px] text-on-surface-variant/80 truncate block">
                        {preset.whatItLooksLike}
                      </span>
                    </div>
                  </div>

                  {/* Content & Metadata */}
                  <div className="flex flex-col gap-1 pt-space-xs flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-headline-xs text-headline-xs text-on-surface font-bold truncate">
                        {preset.name}
                      </h3>
                      {isSelected && (
                        <span className="flex items-center gap-1 text-primary font-label-xs text-label-xs font-semibold shrink-0">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span> Active
                        </span>
                      )}
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 text-[10.5px] leading-tight">
                      {preset.description}
                    </p>

                    {/* Quick Specs Pills */}
                    <div className="flex items-center gap-1 flex-wrap mt-1 pt-1 border-t border-outline-variant/20">
                      <span className="bg-surface-container font-label-xs text-[8.5px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                        {preset.wordsPerGroup}w/group
                      </span>
                      <span className="bg-surface-container font-label-xs text-[8.5px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                        Bounce: {preset.bounceScale}%
                      </span>
                      <span
                        title={renderSupport.description}
                        className={`font-label-xs text-[8.5px] px-1.5 py-0.5 rounded font-mono ${renderSupport.level === "native-shape" ? "bg-secondary/15 text-secondary" : renderSupport.level === "native-motion" ? "bg-primary/15 text-primary" : "bg-error/10 text-error"}`}
                      >
                        {renderSupport.label}
                      </span>
                      <span className="bg-surface-container font-label-xs text-[8.5px] text-on-surface-variant px-1.5 py-0.5 rounded font-mono">
                        Size: {preset.fontSize}px
                      </span>
                    </div>

                    {/* Apply Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPreset(preset);
                      }}
                      className={`mt-2 w-full h-7 rounded-md font-headline-xs text-headline-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        isSelected
                          ? "bg-primary text-on-primary shadow-sm"
                          : "bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {isSelected ? "done" : "play_arrow"}
                      </span>
                      <span>{isSelected ? "Preset Active" : "Apply Preset"}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-space-md py-space-sm bg-surface-container-high border-t border-outline-variant/30">
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            Built-in presets generate editable After Effects text with supported native animators and selected shape treatments. The badges above explain where complex preview effects are simplified in the rendered composition.
          </span>
          <button
            onClick={onClose}
            className="px-space-md h-7 rounded-md bg-surface-variant text-on-surface font-headline-xs text-headline-xs hover:bg-surface-bright transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
