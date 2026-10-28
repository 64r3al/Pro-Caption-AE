import type {
  BuildCaptionsResult,
  CaptionGroupData,
  CaptionStyle,
  FontInfo,
  SelectedAudioLayerInfo,
} from "../../shared/types";

// Phase 1 host surface: read the AE project/comp/layer model (only ExtendScript can do this)
// and hand plain data back to the panel. Everything CPU/IO heavy (ffmpeg, the Groq call) runs
// in the panel's Node context instead, so the host never blocks on network or child processes.

export const getSelectedAudioLayerInfo = (): SelectedAudioLayerInfo => {
  const comp = app.project.activeItem;
  if (!(comp instanceof CompItem)) {
    throw new Error("Open a composition first.");
  }
  if (comp.selectedLayers.length !== 1) {
    throw new Error("Select exactly one layer that contains the voice.");
  }
  const layer = comp.selectedLayers[0];
  if (!(layer instanceof AVLayer)) {
    throw new Error(
      "Select a footage or audio layer (not a shape, text, camera, or light layer)."
    );
  }
  if (!layer.hasAudio) {
    throw new Error("The selected layer has no audio.");
  }
  if (layer.timeRemapEnabled) {
    throw new Error(
      "Time remapping is enabled on this layer. Disable it or pre-render the audio first."
    );
  }
  if (layer.stretch <= 0) {
    throw new Error("Reversed layers (negative stretch) are not supported.");
  }
  const source = layer.source;
  if (!(source instanceof FootageItem) || !source.file) {
    throw new Error(
      "This layer has no source file (precomp or solid). Select the original video/audio layer instead."
    );
  }

  const stretch = layer.stretch / 100;
  const inPoint = Math.max(layer.inPoint, 0);
  const outPoint = Math.min(layer.outPoint, comp.duration);
  if (outPoint <= inPoint) {
    throw new Error("This layer has no visible time in the current composition.");
  }
  const sourceInSeconds = Math.max(0, (inPoint - layer.startTime) / stretch);
  const sourceDurationSeconds = (outPoint - inPoint) / stretch;

  return {
    compId: comp.id,
    compName: comp.name,
    compWidth: comp.width,
    compHeight: comp.height,
    compFrameRate: comp.frameRate,
    compDuration: comp.duration,
    layerIndex: layer.index,
    layerName: layer.name,
    sourceFilePath: source.file.fsName,
    sourceFileName: source.file.name,
    sourceFileSizeBytes: source.file.length,
    startTime: layer.startTime,
    stretchPercent: layer.stretch,
    inPoint: inPoint,
    outPoint: outPoint,
    sourceInSeconds: sourceInSeconds,
    sourceDurationSeconds: sourceDurationSeconds,
  };
};

/** Opens AE's native file-picker dialog so the user can point at an ffmpeg binary manually
 * when auto-detection fails. Uses ExtendScript's File.openDialog rather than a Node dialog
 * since CEP's Node integration has no built-in native file picker. */
export const pickFfmpegExecutable = (): string | null => {
  const f = File.openDialog("Locate the ffmpeg executable", "", false);
  return f ? f.fsName : null;
};

/** Every font installed on this machine, via the Fonts object model added in After Effects
 * 24.0. Returns [] on older versions so the panel can fall back to a built-in list. */
export const listFonts = (): FontInfo[] => {
  const fontsApi = (app as any).fonts;
  if (!fontsApi || !fontsApi.allFonts) return [];
  const out: FontInfo[] = [];
  const groups = fontsApi.allFonts;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    for (let j = 0; j < group.length; j++) {
      const f = group[j];
      try {
        if (f.isSubstitute) continue;
        out.push({ postScriptName: f.postScriptName, family: f.familyName, style: f.styleName });
      } catch (e) {
        // one unreadable font shouldn't hide the rest
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------
// Phase 2: comp/caption building.
//
// AE's property model is dynamic (arbitrary matchName strings, resolved only at runtime;
// see docs/ARCHITECTURE.md) in a way types-for-adobe's static types can't fully capture -
// PropertyGroup.addProperty()/Property.setValue() etc. aren't available on the generic
// `_PropertyClasses` union every `.property(name)` call returns. `p()` steps a property
// chain to `any` at exactly the points that need it (matching how the proven ScriptUI
// prototype this is ported from worked, since ExtendScript itself has no static types at
// all), while everything that IS ours - CaptionGroupData, CaptionStyle, loop control - stays
// properly typed.
// ---------------------------------------------------------------------------------------

const p = (obj: any, name: string | number): any => obj.property(name);

/** Mirrored from shared/constants.ts's POSITION_Y_FRACTIONS (see the file-header comment on
 * why cross-bundle runtime imports from src/shared/ into the ES3 host build aren't used here). */
const POSITION_Y_FRACTIONS = [0.82, 0.7, 0.5, 0.16];

const intToRgb = (n: number): [number, number, number] => [
  ((n >> 16) & 255) / 255,
  ((n >> 8) & 255) / 255,
  (n & 255) / 255,
];

const fmtArr = (arr: number[]): string => {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) parts.push(arr[i].toFixed(4));
  return parts.join(",");
};

// Expression Selector "Amount" expressions: textIndex is 1-based, t[] holds each word's reveal
// time (comp-time seconds). 100 = animator fully applied to that word, 0 = not applied.
const exprHideUntilSpoken = (times: number[]): string =>
  "var t=[" + fmtArr(times) + "];\nvar i=textIndex-1;\n(i<t.length && time<t[i]-0.0001) ? 100 : 0;";

const exprPop = (times: number[], durationSeconds: number): string =>
  "var t=[" + fmtArr(times) + "];\n" +
  "var d=" + durationSeconds.toFixed(4) + ";\n" +
  "var i=textIndex-1;\n" +
  "if (i >= t.length) { 0; } else {\n" +
  "  var el = time - t[i];\n" +
  "  if (el < 0 || el >= d) { 0; } else {\n" +
  "    var p = el / d;\n" +
  "    100 * Math.sin(p * Math.PI) * (1 + 0.3 * (1 - p));\n" +
  "  }\n" +
  "};";

const exprActiveWord = (starts: number[], ends: number[]): string =>
  "var s=[" + fmtArr(starts) + "];\n" +
  "var e=[" + fmtArr(ends) + "];\n" +
  "var i=textIndex-1;\n" +
  "if (i >= s.length) { 0; } else {\n" +
  "  var a = s[i];\n" +
  "  var b = (i < e.length) ? e[i] : a + 0.3;\n" +
  "  (time >= a - 0.0001 && time < b) ? 100 : 0;\n" +
  "};";

const exprRotate = (times: number[], durationSeconds: number): string =>
  "var t=[" + fmtArr(times) + "];\n" +
  "var d=" + durationSeconds.toFixed(4) + ";\n" +
  "var i=textIndex-1;\n" +
  "if (i >= t.length) { 0; } else {\n" +
  "  var el = time - t[i];\n" +
  "  if (el < 0 || el >= d) { 0; } else {\n" +
  "    var p = el / d;\n" +
  "    100 * (1 - p) * (1 - p);\n" +
  "  }\n" +
  "};";

const exprWave = (): string =>
  "var w = Math.sin(time * 10 + textIndex * 1.2);\n" +
  "50 + 50 * w;";

/** Entry motion: full offset (100) until the word's reveal time, then eases out to rest (0)
 * over durationSeconds. Before its time the word is usually hidden by the reveal animator. */
const exprEaseIn = (times: number[], durationSeconds: number): string =>
  "var t=[" + fmtArr(times) + "];\n" +
  "var d=" + durationSeconds.toFixed(4) + ";\n" +
  "var i=textIndex-1;\n" +
  "if (i >= t.length) { 0; } else {\n" +
  "  var el = time - t[i];\n" +
  "  if (el < 0) { 100; } else if (el >= d) { 0; } else {\n" +
  "    var q = 1 - el / d;\n" +
  "    100 * q * q * q;\n" +
  "  }\n" +
  "};";

/** Decaying oscillation at the start of each word, for the shake motion. */
const exprShake = (times: number[]): string =>
  "var t=[" + fmtArr(times) + "];\n" +
  "var i=textIndex-1;\n" +
  "if (i >= t.length) { 0; } else {\n" +
  "  var el = time - t[i];\n" +
  "  (el < 0 || el > 0.4) ? 0 : 100 * Math.sin(el * 70) * (1 - el / 0.4);\n" +
  "};";

/** Adds the animator for one motion. Kept separate from pop/highlight/reveal so every motion
 * combines with those toggles. Unknown motions are ignored rather than failing the build. */
const addMotionAnimator = (lyr: any, motion: string, times: number[], size: number): void => {
  const s = size / 100;
  const move = (name: string, x: number, y: number, d: number) =>
    addWordAnimator(lyr, name, "ADBE Text Position 3D", [[x, y, 0], [x, y]], exprEaseIn(times, d));
  const scale = (name: string, v: number, d: number) =>
    addWordAnimator(lyr, name, "ADBE Text Scale 3D", [[v, v, 100], [v, v]], exprEaseIn(times, d));

  if (motion === "slide-up") move("Slide Up", 0, 70 * s, 0.28);
  else if (motion === "drop-in") move("Drop In", 0, -90 * s, 0.3);
  else if (motion === "slide-left") move("Slide In", 110 * s, 0, 0.3);
  else if (motion === "zoom-in") scale("Grow In", 0, 0.22);
  else if (motion === "zoom-out") scale("Slam", 250, 0.2);
  else if (motion === "blur-in") addWordAnimator(lyr, "Blur Focus", "ADBE Text Blur", [[40, 40]], exprEaseIn(times, 0.3));
  else if (motion === "tracking")
    addWordAnimator(lyr, "Letter Spread", "ADBE Text Tracking Amount", [80], exprEaseIn(times, 0.35));
  else if (motion === "skew") addWordAnimator(lyr, "Skew Swipe", "ADBE Text Skew", [30], exprEaseIn(times, 0.25));
  else if (motion === "rotate") addWordAnimator(lyr, "Rotate In", "ADBE Text Rotation", [-15], exprRotate(times, 0.22));
  else if (motion === "spin") addWordAnimator(lyr, "Spin In", "ADBE Text Rotation", [-360], exprEaseIn(times, 0.4));
  else if (motion === "squash")
    addWordAnimator(lyr, "Squash & Stretch", "ADBE Text Scale 3D", [[130, 70, 100], [130, 70]], exprPop(times, 0.2));
  else if (motion === "wave")
    addWordAnimator(lyr, "Wave Ripple", "ADBE Text Position 3D", [[0, -18 * s, 0], [0, -18 * s]], exprWave());
  else if (motion === "shake")
    addWordAnimator(lyr, "Shake", "ADBE Text Position 3D", [[10 * s, 0, 0], [10 * s, 0]], exprShake(times));
  else if (motion === "fade") addWordAnimator(lyr, "Soft Fade", "ADBE Text Opacity", [0], exprEaseIn(times, 0.3));
};

const textAnimatorsOf = (lyr: any): any => p(p(lyr, "ADBE Text Properties"), "ADBE Text Animators");

/** "Based On: Words" is matchName "ADBE Text Range Type2" = 3 on modern AE; older/localized
 * builds have needed a name-based fallback search, so this tries both (ported as-is from the
 * prototype, which proved this combination necessary). */
const setBasedOnWords = (sel: any): boolean => {
  try {
    sel.property("ADBE Text Range Type2").setValue(3);
    return true;
  } catch (e) {
    // fall through to the search below
  }
  for (let k = 1; k <= sel.numProperties; k++) {
    const prop = sel.property(k);
    if (String(prop.matchName).indexOf("Range Type") !== -1 || prop.name === "Based On") {
      try {
        prop.setValue(3);
        return true;
      } catch (e2) {
        // try the next candidate
      }
    }
  }
  return false;
};

/** Adds a Text Animator with one property (tried against several candidate value shapes,
 * since e.g. "ADBE Text Fill Color" wants a 4-value RGBA array on some AE builds and a
 * 3-value RGB array on others) and an Expression-Selector-driven Amount, based on words. */
const addWordAnimator = (
  lyr: any,
  name: string,
  propMatch: string,
  values: unknown[],
  expr: string
): void => {
  const animators = textAnimatorsOf(lyr);
  const animator = animators.addProperty("ADBE Text Animator");
  const animatorIndex = animator.propertyIndex;
  animator.name = name;
  const getAnimator = () => textAnimatorsOf(lyr).property(animatorIndex);

  getAnimator().property("ADBE Text Animator Properties").addProperty(propMatch);
  const prop = getAnimator().property("ADBE Text Animator Properties").property(propMatch);
  let ok = false;
  for (let v = 0; v < values.length && !ok; v++) {
    try {
      prop.setValue(values[v]);
      ok = true;
    } catch (e) {
      // try the next candidate value shape
    }
  }

  getAnimator().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
  let selector = getAnimator().property("ADBE Text Selectors").property(1);
  if (!setBasedOnWords(selector)) {
    throw new Error("Could not set the Expression Selector to 'Based On: Words'.");
  }
  // Re-fetch: addProperty()/setValue() calls above can invalidate sibling property references.
  selector = getAnimator().property("ADBE Text Selectors").property(1);
  selector.property("ADBE Text Expressible Amount").expression = expr;
};

/** Per-word reveal times for one caption's word-by-word animation: leadInFrames early, never
 * before the caption's own start. Mirrors shared/captions.ts#revealTimes exactly, kept as a
 * tiny local copy rather than a cross-bundle import - see the file-header comment above. */
const revealTimesFor = (group: CaptionGroupData, leadInFrames: number, fps: number): number[] => {
  const leadInSeconds = leadInFrames / fps;
  const times: number[] = [];
  for (let i = 0; i < group.words.length; i++) {
    times.push(Math.max(group.start, group.words[i].start - leadInSeconds));
  }
  return times;
};

const createCaptionLayer = (
  comp: CompItem,
  group: CaptionGroupData,
  index: number,
  style: CaptionStyle
): TextLayer => {
  // shared/captions.ts's wrapLines joins wrapped lines with "\n" (a host-agnostic choice, so
  // the same CaptionGroupData is usable for a future panel-side preview too); AE's
  // TextDocument.text specifically wants "\r" as its paragraph line break, a long-standing
  // ExtendScript quirk, so that conversion happens here and only here.
  const aeText = group.text.replace(/\n/g, "\r");
  const lyr = comp.layers.addText(aeText);
  try {
    const label = group.text.replace(/\r|\n/g, " ");
    const numberPrefix = index < 10 ? "00" : index < 100 ? "0" : "";
    lyr.name = "CAP " + numberPrefix + index + "  " + label.substr(0, 24);

    const srcProp = p(p(lyr, "ADBE Text Properties"), "ADBE Text Document");
    const doc: TextDocument = srcProp.value;
    try {
      doc.resetCharStyle();
    } catch (e0) {
      // not fatal - some AE versions/fonts don't support a full style reset
    }
    doc.text = aeText;
    try {
      doc.font = style.font;
    } catch (e1) {
      // invalid/missing PostScript font name - fall back to whatever font AE already picked
    }
    doc.fontSize = style.size;
    doc.applyFill = true;
    doc.fillColor = intToRgb(style.textColor);
    if (style.strokeWidth > 0) {
      doc.applyStroke = true;
      doc.strokeColor = intToRgb(style.strokeColor);
      doc.strokeWidth = style.strokeWidth;
      doc.strokeOverFill = false;
    } else {
      doc.applyStroke = false;
    }
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    srcProp.setValue(doc);

    lyr.inPoint = group.start;
    lyr.outPoint = group.end;

    // Word-based anchor grouping so per-word scale pops from each word's own center.
    try {
      p(p(lyr, "ADBE Text Properties"), "ADBE Text More Options")
        .property("ADBE Text Anchor Point Option")
        .setValue(2);
    } catch (e2) {
      // cosmetic only - pop animation still works, just anchored at the layer's default point
    }

    const transform = lyr.property("ADBE Transform Group");
    p(transform, "ADBE Anchor Point").expression =
      "var r=sourceRectAtTime(outPoint-thisComp.frameDuration,false);\n[r.left+r.width/2, r.top+r.height/2];";
    // yOffset is authored against a 1920px-tall frame; scale it to this comp's height.
    const yOffset = style.yOffset != null ? (style.yOffset * comp.height) / 1920 : 0;
    p(transform, "ADBE Position").setValue([
      comp.width / 2,
      comp.height * POSITION_Y_FRACTIONS[style.posIndex] + yOffset,
    ]);

    const times = revealTimesFor(group, style.leadInFrames, comp.frameRate);
    const endTimes: number[] = [];
    for (let i = 0; i < group.words.length; i++) {
      const nextStart = i + 1 < group.words.length ? group.words[i + 1].start : group.end;
      endTimes.push(Math.min(group.end, Math.max(group.words[i].end, nextStart)));
    }

    if (style.highlight) {
      const hc = intToRgb(style.highlightColor);
      addWordAnimator(
        lyr,
        "Active Word",
        "ADBE Text Fill Color",
        [[hc[0], hc[1], hc[2], 1], hc],
        exprActiveWord(times, endTimes)
      );
    }
    if (style.pop) {
      // The selector swings 0 -> ~100 -> 0 right after each reveal, so the word overshoots to
      // (100 + bounce)% and settles back at 100%.
      const peak = 100 + (style.bounceScale != null ? style.bounceScale : 30);
      addWordAnimator(
        lyr,
        "Pop In",
        "ADBE Text Scale 3D",
        [[peak, peak, 100], [peak, peak]],
        exprPop(times, 0.18)
      );
    }
    // Older callers only sent animMode; the three modes they could animate map 1:1.
    const motion =
      style.motion != null
        ? style.motion
        : style.animMode === "rotate" || style.animMode === "squash" || style.animMode === "wave"
        ? style.animMode
        : "none";
    if (motion !== "none") {
      try {
        addMotionAnimator(lyr, motion, times, style.size);
      } catch (eMotion) {
        // a motion AE can't apply on this build/font shouldn't cost the whole caption
      }
    }
    if (style.reveal) {
      addWordAnimator(lyr, "Reveal (synced)", "ADBE Text Opacity", [0], exprHideUntilSpoken(times));
    }
    if (style.shadow) {
      try {
        const fx = p(lyr, "ADBE Effect Parade").addProperty("ADBE Drop Shadow");
        p(fx, "ADBE Drop Shadow-0004").setValue(6);
        p(fx, "ADBE Drop Shadow-0005").setValue(14);
      } catch (e3) {
        // drop shadow is cosmetic - skip it rather than fail the whole build
      }
    }
  return lyr;
  } catch (error: any) {
    try {
      lyr.remove();
    } catch (cleanupError: any) {
      const originalMessage = error && error.message ? error.message : String(error);
      const cleanupMessage = cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError);
      throw new Error(
        "Caption layer creation failed: " + originalMessage +
        ". Automatic cleanup of the partial layer also failed: " + cleanupMessage +
        ". Please inspect the composition before continuing."
      );
    }
    throw error;
  }
};

interface PresetDecorationConfig {
  kind: "background" | "underline" | "marker";
  color: number;
  opacity: number;
  paddingX: number;
  paddingY: number;
  radius: number;
}

const getPresetDecorationConfig = (style: CaptionStyle): PresetDecorationConfig | null => {
  const mode = style.animMode || "";
  if (mode === "underline") {
    return {
      kind: "underline",
      color: style.highlightColor,
      opacity: 100,
      paddingX: 14,
      paddingY: 5,
      radius: 2,
    };
  }
  if (mode === "marker") {
    return {
      kind: "marker",
      color: style.highlightColor,
      opacity: 48,
      paddingX: 12,
      paddingY: 1,
      radius: 2,
    };
  }

  // Native AE rectangle treatments for card-style presets. These are deliberately simple,
  // editable shape layers; the UI must not imply that browser-only icons/chrome are reproduced.
  if (mode === "sticker") return { kind: "background", color: 0xffffff, opacity: 100, paddingX: 30, paddingY: 20, radius: 10 };
  if (mode === "sticky-note") return { kind: "background", color: 0xffe47a, opacity: 100, paddingX: 34, paddingY: 24, radius: 2 };
  if (mode === "blur-box") return { kind: "background", color: 0x16181d, opacity: 88, paddingX: 28, paddingY: 16, radius: 12 };
  if (mode === "terminal") return { kind: "background", color: 0x06150d, opacity: 96, paddingX: 34, paddingY: 22, radius: 6 };
  if (mode === "search-bar") return { kind: "background", color: 0x202124, opacity: 100, paddingX: 36, paddingY: 20, radius: 24 };
  if (mode === "reddit") return { kind: "background", color: 0x1a1a1b, opacity: 96, paddingX: 30, paddingY: 18, radius: 8 };
  if (mode === "tweet") return { kind: "background", color: 0x050505, opacity: 94, paddingX: 30, paddingY: 18, radius: 10 };
  if (mode === "quote") return { kind: "background", color: 0x242424, opacity: 92, paddingX: 36, paddingY: 26, radius: 8 };
  if (mode === "stat-card") return { kind: "background", color: 0x111827, opacity: 96, paddingX: 36, paddingY: 24, radius: 12 };
  if (mode === "newspaper") return { kind: "background", color: 0xf1e8d4, opacity: 100, paddingX: 32, paddingY: 22, radius: 0 };
  if (mode === "callout") return { kind: "background", color: 0x11233a, opacity: 94, paddingX: 28, paddingY: 18, radius: 8 };
  if (mode === "timeline") return { kind: "background", color: 0x12243a, opacity: 92, paddingX: 24, paddingY: 16, radius: 6 };
  if (mode === "chapter") return { kind: "background", color: 0x0b0b0d, opacity: 90, paddingX: 36, paddingY: 26, radius: 0 };
  if (mode === "stamp") return { kind: "background", color: 0x3a2020, opacity: 90, paddingX: 24, paddingY: 14, radius: 1 };
  if (mode === "diary") return { kind: "background", color: 0xf0e3c8, opacity: 100, paddingX: 34, paddingY: 22, radius: 2 };
  if (mode === "collage") return { kind: "background", color: 0xf7f4eb, opacity: 100, paddingX: 26, paddingY: 22, radius: 4 };
  if (mode === "hologram") return { kind: "background", color: 0x062b32, opacity: 58, paddingX: 26, paddingY: 18, radius: 4 };
  return null;
};

/** Builds editable native shape treatments for presets that call for a box, marker, or underline.
 * The shape follows the text layer's position and shares its in/out points, so the decoration
 * remains synchronized when the generated caption composition is moved or trimmed. */
const createPresetDecorationLayer = (
  comp: CompItem,
  textLayer: TextLayer,
  group: CaptionGroupData,
  index: number,
  style: CaptionStyle
): ShapeLayer | null => {
  const config = getPresetDecorationConfig(style);
  if (!config) return null;

  const shape = comp.layers.addShape();
  try {
    const bounds = (textLayer as any).sourceRectAtTime(group.start, false);
    const measuredWidth = bounds && isFinite(bounds.width) ? Math.max(1, bounds.width) : Math.max(1, style.size * group.text.length * 0.55);
    const measuredHeight = bounds && isFinite(bounds.height) ? Math.max(1, bounds.height) : Math.max(1, style.size * 1.2);
    let width = measuredWidth + config.paddingX * 2;
    let height = measuredHeight + config.paddingY * 2;
    let offsetY = 0;

    if (config.kind === "underline") {
      height = Math.max(3, style.size * 0.055);
      offsetY = measuredHeight / 2 + Math.max(2, config.paddingY);
    } else if (config.kind === "marker") {
      height = Math.max(8, measuredHeight * 0.55 + config.paddingY * 2);
      offsetY = measuredHeight * 0.12;
    }

    const root = p(shape, "ADBE Root Vectors Group");
    const groupVectors = root.addProperty("ADBE Vector Group");
    groupVectors.name = "Caption Decoration " + index;
    const vectors = p(groupVectors, "ADBE Vectors Group");
    const rectangle = vectors.addProperty("ADBE Vector Shape - Rect");
    p(rectangle, "ADBE Vector Rect Size").setValue([width, height]);
    p(rectangle, "ADBE Vector Rect Position").setValue([0, offsetY]);
    p(rectangle, "ADBE Vector Rect Roundness").setValue(config.radius);
    const fill = vectors.addProperty("ADBE Vector Graphic - Fill");
    p(fill, "ADBE Vector Fill Color").setValue(intToRgb(config.color));
    p(fill, "ADBE Vector Fill Opacity").setValue(config.opacity);

    const yOffset = style.yOffset != null ? (style.yOffset * comp.height) / 1920 : 0;
    p(shape, "ADBE Transform Group").property("ADBE Position").setValue([
      comp.width / 2,
      comp.height * POSITION_Y_FRACTIONS[style.posIndex] + yOffset,
    ]);
    shape.name = "CAP DECOR " + (index < 10 ? "00" : index < 100 ? "0" : "") + index;
    shape.inPoint = group.start;
    shape.outPoint = group.end;
    // Put the shape behind generated text. Only the generated layers are later precomposed.
    shape.moveToEnd();
    return shape;
  } catch (error: any) {
    try {
      shape.remove();
    } catch (cleanupError: any) {
      const originalMessage = error && error.message ? error.message : String(error);
      const cleanupMessage = cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError);
      throw new Error(
        "Preset decoration creation failed: " + originalMessage +
        ". Automatic cleanup failed: " + cleanupMessage +
        ". Please inspect the composition before continuing."
      );
    }
    throw error;
  }
};

/** Builds every caption layer and precomposes them, in one undo step. `groups` must already
 * be fully computed (comp-time, frame-quantized, grouped) by the panel - see
 * src/shared/sync.ts and src/shared/captions.ts - so this function is pure AE-object-model
 * work and never needs to re-derive timing. */
export const buildCaptions = (
  compId: number,
  groups: CaptionGroupData[],
  style: CaptionStyle
): BuildCaptionsResult => {
  const comp = app.project.activeItem;
  if (!(comp instanceof CompItem) || comp.id !== compId) {
    throw new Error("Open the same composition you generated the transcript in.");
  }
  if (!groups.length) {
    throw new Error("No words to build captions from.");
  }
  if (!style || typeof style.font !== "string" || !style.font.replace(/^\s+|\s+$/g, "")) {
    throw new Error("Choose a valid font before building captions.");
  }
  if (!isFinite(style.size) || style.size <= 0) {
    throw new Error("Caption font size must be a positive number.");
  }
  if (!isFinite(style.strokeWidth) || style.strokeWidth < 0) {
    throw new Error("Caption stroke width must be zero or a positive number.");
  }
  if (
    style.posIndex !== 0 &&
    style.posIndex !== 1 &&
    style.posIndex !== 2 &&
    style.posIndex !== 3
  ) {
    throw new Error("Caption position is invalid. Choose Top, Center, Lower third, or Bottom.");
  }

  let wordCount = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group || !group.words || !group.words.length || typeof group.text !== "string" || !group.text.replace(/^\s+|\s+$/g, "")) {
      throw new Error("Caption group " + (i + 1) + " has no usable text.");
    }
    if (
      !isFinite(group.start) ||
      !isFinite(group.end) ||
      group.start < 0 ||
      group.end <= group.start ||
      group.end > comp.duration + 1e-6
    ) {
      throw new Error("Caption group " + (i + 1) + " has invalid timing.");
    }
    for (let j = 0; j < group.words.length; j++) {
      const word = group.words[j];
      if (
        !word ||
        typeof word.text !== "string" ||
        !word.text.replace(/^\s+|\s+$/g, "") ||
        !isFinite(word.start) ||
        !isFinite(word.end) ||
        word.start < 0 ||
        word.end < word.start
      ) {
        throw new Error("Caption group " + (i + 1) + " contains invalid word timing or text.");
      }
      wordCount++;
    }
  }

  const precompName = "Captions - " + comp.name;
  const originalProjectItemCount = app.project.numItems;
  const layers: any[] = [];
  let precompItem: any = null;
  app.beginUndoGroup("Pro Caption AE");
  try {
    for (let i = 0; i < groups.length; i++) {
      const textLayer = createCaptionLayer(comp, groups[i], i + 1, style);
      layers.push(textLayer);
      const decorationLayer = createPresetDecorationLayer(comp, textLayer, groups[i], i + 1, style);
      if (decorationLayer) layers.push(decorationLayer);
    }
    const indices: number[] = [];
    for (let j = 0; j < layers.length; j++) indices.push(layers[j].index);
    precompItem = comp.layers.precompose(indices, precompName, true);
    precompItem.comment = "Generated by Pro Caption AE";
  } catch (error: any) {
    const cleanupErrors: string[] = [];
    const originalMessage = error && error.message ? error.message : String(error);

    if (precompItem) {
      for (let index = comp.numLayers; index >= 1; index--) {
        try {
          const parentLayer: any = comp.layer(index);
          if (parentLayer && parentLayer.source === precompItem) {
            parentLayer.remove();
          }
        } catch (removeParentError: any) {
          cleanupErrors.push("could not remove the generated precomposition layer");
        }
      }
      try {
        precompItem.remove();
      } catch (removePrecompError: any) {
        cleanupErrors.push("could not remove the generated precomposition item");
      }
    } else {
      for (let k = layers.length - 1; k >= 0; k--) {
        try {
          layers[k].remove();
        } catch (removeLayerError: any) {
          cleanupErrors.push("could not remove generated layer " + (k + 1));
        }
      }
      // If precompose itself failed after creating its project item, clean only items that
      // were created during this synchronous operation; pre-existing user items are untouched.
      for (let itemIndex = app.project.numItems; itemIndex > originalProjectItemCount; itemIndex--) {
        try {
          const item: any = app.project.item(itemIndex);
          if (item instanceof CompItem) item.remove();
        } catch (removeNewItemError: any) {
          cleanupErrors.push("could not inspect/remove a newly created project item");
        }
      }
    }

    if (cleanupErrors.length) {
      throw new Error(
        "Caption build failed: " + originalMessage +
        ". Automatic cleanup was incomplete (" + cleanupErrors.join("; ") +
        "). Please inspect the composition before continuing."
      );
    }
    throw error;
  } finally {
    app.endUndoGroup();
  }

  return { words: wordCount, captions: groups.length, precompName: precompName };
};


/** Opens After Effects' native save dialog for a supported subtitle/data export. */
export const pickExportPath = (format: string): string | null => {
  let extension = "";
  let title = "Export file";
  if (format === "srt") {
    extension = "srt";
    title = "Export SubRip subtitles";
  } else if (format === "vtt") {
    extension = "vtt";
    title = "Export WebVTT subtitles";
  } else if (format === "json") {
    extension = "json";
    title = "Export transcript JSON";
  } else {
    throw new Error("Unsupported export format.");
  }

  const chosen = File.saveDialog(title, "*." + extension);
  if (!chosen) return null;
  const currentPath = chosen.fsName;
  const requiredSuffix = "." + extension;
  return currentPath.toLowerCase().slice(-requiredSuffix.length) === requiredSuffix
    ? currentPath
    : currentPath + requiredSuffix;
};
