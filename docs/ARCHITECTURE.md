# Architecture

Per the master prompt's "before writing code" request: architecture, folder structure, data
model, and open questions/risks. Originally written after Phase 1, since the concrete
scaffold made several of these decisions easier to explain precisely than describing them in
the abstract, and updated as Phase 2 (word-sync + comp building) landed — but it covers the
full plan, not just what's built so far.

## Platform choice: CEP (not UXP)

UXP doesn't support After Effects yet, so CEP is the only option today, per the master
prompt. Scaffolded with [bolt-cep](https://github.com/hyperbrew/bolt-cep) (Vite + TypeScript
+ React) rather than hand-rolled, for three concrete reasons:

1. **`evalTS`**: a typed, promise-based bridge (`src/js/lib/utils/bolt.ts`) that serializes
   arguments/return values as JSON between the panel and ExtendScript, with host-side
   exceptions turned into rejected promises. This *is* the "typed bridge layer" the master
   prompt asks for.
2. **Adobe's real `CSInterface.js`**, not a hand-transcribed copy — panel/host communication,
   theming events, and file-system paths are foundational enough that subtle bugs here would
   be painful to track down without a real AE install to test against in this environment.
3. **Manifest + debug-mode + ZXP packaging** generation is handled by `vite-cep-plugin`
   instead of hand-written XML, removing an entire class of "extension won't load" bugs.

Everything CEP-specific and framework-provided is documented in `NOTICE.md` so it's clear
what's original to this project.

## Folder structure

```
cep.config.ts              Extension identity, panel size, icons, build/zxp settings
vite.config.ts              Panel build (React, → dist/cep/js)
vite.es.config.ts           ExtendScript build (TS → ES3, → dist/cep/jsx/index.js)

src/jsx/                    Host code — runs inside After Effects as ExtendScript (ES3)
  aeft/aeft.ts                 evalTS-callable functions: layer info, ffmpeg picker, listFonts,
                                  buildCaptions() (comp/text-layer generation, Phase 2)
  lib/json2.js                 JSON polyfill (ES3 has no native JSON)
  index.ts                     Picks the right per-app module and exports the Scripts type

src/js/                     Panel code — runs in CEP's Chromium/Node context
  main/
    App.tsx                    Single-screen studio: Transcribe / Style & Animation / Settings,
                                  live preview, Transcribe + Build in AE actions
    tailwind.css               Tailwind entry (theme in /tailwind.config.js, compiled at build)
    features/PresetLibraryModal.tsx   Full preset browser
    features/FontPicker.tsx          Searchable installed-font picker
    components/SettingsTab.tsx       API key + ffmpeg
  lib/
    services/                  Node-side business logic (this project's, not bolt-cep's)
      env.ts                     Node-availability guard, settings-dir resolution
      settingsStore.ts           Encrypted-at-rest local settings (API key, ffmpeg path)
      apiKey.ts                  Key resolution (Settings > .env.local) + key testing
      ffmpeg.ts                  Locate ffmpeg, extract trimmed audio in the background
      onset.ts                    ffmpeg PCM decode -> src/shared/onset.ts's RMS detection
      groq.ts                    Groq Whisper API client (manual multipart, 429 backoff)
      pipeline.ts                Selection -> transcript (extract, chunk, transcribe, stitch,
                                   cancel, temp cleanup) + onset refinement before a build
      fonts.ts                   Installed-font list (via aeft listFonts) + cached choice
      theme.ts                   Match the host app's current color theme
    cep/, utils/                bolt-cep's CEP glue (CSInterface, evalTS, node.ts, theming)

src/shared/                 Pure logic + types shared between panel and host, no CEP/AE
                               imports, unit tested with Vitest (npm run test, 56 tests)
  types.ts                    SelectedAudioLayerInfo, TranscriptWord/Result, CaptionGroupData/
                                 CaptionStyle, ApiKeyStatus
  constants.ts                 Groq URLs, upload limits, sync/grouping/style/chunking defaults
  sync.ts                       source->comp time mapping, frame quantization, sync
  captions.ts                    caption grouping, line wrapping, reveal timing
  onset.ts                       RMS envelope + nearest-onset detection math
  chunking.ts                    long-audio chunk planning + overlap-aware stitching
  presets.ts                     the 66 presets shown in the panel (classic + Kinetic Motion)
  motion.ts                      motion types + each preset animMode's After Effects motion
  fonts.ts                       PostScript name -> CSS preview font, font search/sort

docs/ARCHITECTURE.md        This file
```

## Data flow (Phase 1 + 2)

```
 ExtendScript (src/jsx/aeft/aeft.ts)
   getSelectedAudioLayerInfo()  →  { compId, layerName, sourceFilePath,
                                      sourceInSeconds, sourceDurationSeconds, ... }
             │  evalTS (JSON over evalScript)
             ▼
 CEP panel — Transcribe (App.tsx#handleTranscribe → lib/services/pipeline.ts#transcribeSelection)
   1. resolveApiKey()                    settings.json (encrypted) → .env.local → none
   2. findFfmpeg() + extractAudio()       child_process, background, → temp .flac
      (or planChunks()+multiple extractAudio() calls if longer than CHUNK_MAX_SECONDS)
   3. transcribe() [per chunk]            https POST (manual multipart) → Groq Whisper
   4. normalizeWords() / stitchTranscriptChunks()   verbose_json → flat TranscriptWord[]
             │  raw words, source-relative seconds
             ▼
 CEP panel — Build in AE (App.tsx#handleBuildInAe, pipeline.ts#refineWordTiming)
   5. refineOnsets()         ffmpeg PCM decode + RMS envelope → onset-snapped starts
   6. syncWords()             source time → comp time → frame-quantized (shared/sync.ts)
   7. buildGroups()           words → captions with on-screen start/end + wrapped text
             │  CaptionGroupData[] + CaptionStyle, JSON-serializable
             │  evalTS("buildCaptions", compId, groups, style)
             ▼
 ExtendScript (src/jsx/aeft/aeft.ts#buildCaptions)
   8. One text layer per caption, Expression-Selector word animators, one precompose,
      one app.beginUndoGroup — see "Comp building" below.
```

Phase 1 deliberately wrote nothing back into the AE project: building comps/layers is real,
order-dependent AE-DOM work, and mixing it into the same pass as "does transcription work
at all" would have made failures harder to attribute to either half.
`getSelectedAudioLayerInfo()` was designed in Phase 1 to already return everything Phase 2's
comp builder needs (`startTime`, `stretchPercent`, `inPoint`/`outPoint`, `compFrameRate`,
`compDuration`), so step 5-8 above turned out to be additive, not a rewrite of steps 1-4.

## Data model

### `SelectedAudioLayerInfo` (host → panel, per generate click)

The layer/comp facts only ExtendScript can read. `sourceInSeconds`/`sourceDurationSeconds`
are already source-time-mapped (accounting for `startTime`, `inPoint`/`outPoint` clamped to
the comp, and `stretch`) so the panel can hand them straight to ffmpeg's `-ss`/`-t`.

### `TranscriptResult` / `TranscriptWord` (Groq → panel)

```ts
interface TranscriptWord { text: string; start: number; end: number } // seconds, source-relative
interface TranscriptResult {
  text: string;
  language?: string;
  duration?: number;
  words: TranscriptWord[];      // from verbose_json.words, or spread evenly across segments
  segments: GroqSegment[];      // kept for future segment-level review; not a calibrated per-word confidence score
}
```

### `CaptionGroupData` / `CaptionStyle` (panel → host, per Build/Rebuild Captions click)

What the panel hands to `buildCaptions()` in one `evalTS` call, already fully computed
(comp-time, frame-quantized, grouped) so the host does nothing but AE-object-model work:

```ts
interface CaptionGroupData {
  words: TranscriptWord[]; // comp-time seconds now, not source-relative
  start: number;
  end: number;
  text: string;            // "\n" between wrapped lines
}
interface CaptionStyle {
  font: string; size: number;
  textColor: number; highlightColor: number; strokeColor: number; strokeWidth: number; // 0xRRGGBB
  posIndex: 0 | 1 | 2 | 3;  // Bottom / Lower third / Center / Top
  reveal: boolean; highlight: boolean; pop: boolean; shadow: boolean;
  leadInFrames: number;
}
```

### Deferred: the on-disk `captions.json` + single-text-layer approach

The master prompt's "performance-first" comp-building idea — one text layer driven by
`footage("captions.json").sourceData` plus Expression Selectors, rather than one text layer
per caption — is real and worth doing, but Phase 2 builds N discrete precomposed text
layers instead (closer to `Groq_Captions.jsx`'s original design). Deliberately deferred
rather than built speculatively: the whole point of the JSON-driven approach is "edit a
word/timing and the comp updates without a rebuild," which only pays off when the editor also persists edits and can rebuild its generated composition reliably. Building it now would mean guessing at the
editor's needs; building it alongside the editor means the file shape is driven by what the
editor actually needs to read and write. "Bake to layers" (today's Phase 2 behavior) stays
available either way as an explicit option for manual per-layer tweaking outside the editor.

### Settings (`settingsStore.ts`, per-OS user profile dir, not in the repo)

```ts
interface StoredSettings {
  apiKey?: { iv: string; tag: string; data: string }; // AES-256-GCM, key in a sibling 0600 file
  ffmpegPath?: string;                                  // user override, if auto-detect failed
}
```

## Key decisions and why

- **Multipart built by hand instead of the `form-data` npm package** the master prompt's
  reference snippet uses. CEP's Node module resolution only sees packages actually shipped
  inside the extension; wiring up `installModules` (vite-cep-plugin's mechanism for copying
  npm deps into the packaged extension) for one dependency used to emit a few MIME boundary
  lines wasn't worth the packaging-time risk. `src/js/lib/services/groq.ts` builds the same
  wire format directly against Node's `https`.
- **Encrypted-at-rest file instead of a real OS keychain** for the saved API key
  (`settingsStore.ts`). A true keychain (macOS Keychain / Windows Credential Manager) needs a
  native module (e.g. `keytar`), which means prebuilt binaries per OS/arch shipped inside the
  extension — real work, and not testable in this sandbox. AES-256-GCM with a random
  locally-held key is what the master prompt names as the acceptable fallback ("OS keychain
  if possible, otherwise encrypted local storage"); upgrading to a real keychain is a good
  Phase 5 polish item.
- **Chunking resolves overlaps by time, not text matching.** `shared/chunking.ts`'s
  `stitchTranscriptChunks` splits each pair of adjacent (overlapping) chunks at a single
  deterministic cutover — the midpoint of their shared audio — rather than trying to match
  up Whisper's transcription of the same audio twice (which isn't guaranteed to tokenize
  identically at the seam). Onset refinement is deliberately not offered for a chunked
  transcript (no single audio file represents the whole clip to re-analyze); the UI states
  this plainly rather than silently skipping it.
- **Onset refinement snaps to the nearest rising edge, not the loudest point.** A word's
  audible start is where energy *begins*, not its peak — snapping to the peak would
  systematically land inside the word. `findNearestOnset` (shared/onset.ts) also picks
  whichever of several nearby rising edges is closest to Whisper's reported time (relevant
  when words are close together) and ignores energy that was already sustained above
  threshold going into the search window (so it doesn't mistake "still mid-word from
  before" for a new onset).
- **`installModules: []` in `cep.config.ts` is correct, not an oversight.** That field copies
  third-party npm packages into the packaged extension so `require("pkg")` resolves at
  runtime in an installed ZXP (dev mode has full `node_modules`, but the shipped package
  doesn't). Every Node-side service (`ffmpeg.ts`, `groq.ts`, `settingsStore.ts`, `apiKey.ts`)
  uses only Node built-ins (`fs`, `https`, `child_process`, `os`, `path`, `crypto`) via
  `src/js/lib/cep/node.ts`'s `require()` wrapper — no third-party runtime package is ever
  `require()`'d. This is exactly why the multipart body is hand-built instead of using
  `form-data` (previous bullet): it lets `installModules` stay empty and removes a whole
  class of "works in dev, breaks once packaged" bugs.
- **`vitest` is pinned to `^3.2.7`, not upgraded to `5.x`**, despite `npm audit` flagging a
  moderate advisory ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9))
  in `@vitest/mocker`'s redirect-mock feature that spans the entire 2.x–4.x line and is only
  fixed in 5.0.2. We don't use mocking at all (the test suite is pure functions in and
  assertions out), vitest is dev-only tooling that never ships in the extension or runs
  against untrusted input, and 5.x raises the `@types/node`/Node engine floor in ways that
  weren't worth destabilizing the CEP build for a feature this project doesn't touch.
  Revisit if the test suite ever needs mocking, or when 5.x's peer requirements are less of
  a jump.
- **`cep.config.ts` must stay a side-effect-free plain data literal — no `process.env` reads,
  no top-level logic.** This bit us once already (caught before merging, not after): its
  default export is imported by `src/shared/shared.ts` for `ns`/`company`/etc., and
  `shared.ts` is imported by `src/jsx/index.ts` — meaning `cep.config.ts`'s *entire module
  body* gets bundled into the ExtendScript output that runs inside After Effects, not just
  used by the Node-side Vite build. A first version of the ZXP_PASSWORD fix (previous ARCHITECTURE
  revision) read `process.env.ZXP_PASSWORD` at this file's top level; `process` doesn't exist
  in ExtendScript's global scope, so that would have thrown the moment the host script loaded
  in AE, silently breaking the entire extension (not just packaging) — caught by grepping the
  actual compiled `dist/cep/jsx/index.js` output for `process`, not by `tsc` (which has no way
  to know this file crosses into the ES3 bundle) or by `vite build` succeeding (it did; the
  bug was in bundled *content*, not a build error). The real fix: keep `cep.config.ts` a pure
  literal (`zxp.password: ""` placeholder) and do the env read/validation/injection in
  `vite.config.ts` instead, which is never imported by anything in `src/jsx/`. If you ever
  need to change something build-config-related and it feels like it needs a `process.env`
  read, check first whether it's happening in a file `shared.ts` (transitively) imports.

## Open questions / risks

1. **I can't run After Effects here.** This sandbox has no AE install, so both phases are
   verified by `npm run build`/`typecheck`/`test` and careful reading of types-for-adobe's
   declarations — not by actually clicking through the panel. The Step 0 audit process (see
   git history / PR discussion) already caught one real bug this way missed by every
   automated check (a `process.env` read that would have broken the extension from loading
   at all in AE — see the `cep.config.ts` bullet above) by grepping compiled *output*, not
   just running the build; that's the level of scrutiny this kind of gap needs. For Phase 2
   specifically, the highest-risk untested spots are: the Expression Selector "Based On:
   Words" fallback search in `setBasedOnWords` (only the primary `ADBE Text Range Type2`
   path is exercised by types-for-adobe's declarations; the name-search fallback exists
   because the prototype needed it on *some* AE build, but which one wasn't recorded), and
   whether "ADBE Text Fill Color"'s value-shape fallback (4-value RGBA tried before 3-value
   RGB) actually needs both branches on current AE versions or just one. Please run the
   acceptance test in **How to test Phase 2** (README) and report back. Phase 1's own
   previously-flagged risk here remains open too: `getHostEnvironment()`/`appSkinInfo`
   theming (typed as `any` in Adobe's own `.d.ts`) and the exact CSXS/debug-port version for
   your AE build (README now covers CEP 11 vs. 12 explicitly, including the known CEP 12
   PlayerDebugMode bug).
2. **ffmpeg auto-detection is best-effort.** The candidate-path list is carried over from the
   prototype (winget/choco/scoop on Windows, homebrew/usr-local/usr on macOS) plus a
   `where`/`command -v` fallback. If your install lives somewhere else, "Locate ffmpeg…" in
   Settings covers it, but first-run UX for someone with no ffmpeg and a large/uncommon-format
   clip is still just an error message, not an in-panel installer.
3. **The AES-at-rest key protection is convenience, not a hard security boundary** — see
   above. Worth flagging explicitly since the master prompt is understandably strict about
   never leaking the API key.
4. **Bundling ffmpeg binaries per-platform** (master prompt: "Bundle ffmpeg binaries per
   platform, use an LGPL build and respect its license") isn't done — Phase 1 only detects a
   system install. Bundling means bringing in real per-OS/arch LGPL binaries (several tens of
   MB each) plus license-compliance paperwork, which needs a decision on hosting/repo size
   before I add it as a build step.
5. **Vocabulary prompt token counting is a word-count approximation**, not the actual
   tokenizer Groq uses server-side, so the 224-token warning in the Transcribe tab is a
   rough guardrail, not an exact one.
6. **Known, deliberately-not-fixed findings from the Step 0 audit** (reported in full then;
   summarized here so they're not only in chat history): `ffmpeg.ts#findFfmpeg`'s `which()`
   fallback uses a synchronous `execSync` (blocks the panel's own render thread briefly, not
   After Effects itself); `groq.ts` reads the whole audio file synchronously and re-reads it
   on every 429 retry; `SettingsTab.tsx`'s handlers have no try/catch, so a settings-file
   write failure fails silently. (Switching tabs mid-transcription no longer loses work: the
   job lives in `App.tsx`, and closing the panel cancels it and removes its temp audio.) None of these are
   correctness bugs in the sync/caption-building logic Phase 2 added; they're pre-existing
   Phase 1 robustness gaps, left as-is per the audit's scope (fix what the README's own test
   checklist promises, report the rest).

## Phase status

- **Phase 1 — Foundation:** CEP scaffold, manifest/debug/ZXP config, typed bridge, settings, audio extraction, Groq integration, and the original transcript pipeline.
- **Phase 2 — Caption generation:** frame-quantized time mapping, RMS-envelope onset refinement, grouping, and native After Effects text-layer generation with per-word expression selectors. Long audio is chunked and stitched.
- **Phase 3 — Transcript editing (partial in v1.3.0):** the panel has word-level text and timestamp correction, insertion/deletion, selection, and a timeline-linked preview playhead. It does not yet provide group split/merge controls, project-persistent transcript data, or a JSON-driven one-layer representation.
- **Phase 4 — Export and motion support (partial in v1.3.0):** 66 built-in presets, 15 native text motion types, basic native shape treatments for selected preset types, preset support labels, custom preset save/delete, and SRT/WebVTT/JSON exports. Complex browser-only visual chrome and advanced effects are still simplified for presets identified by the UI as text approximations.
- **Phase 5 — Reliability and release improvements (partial in v1.3.0):** transcript validation, bounded HTTP request timeout, bounded/cancellable retry backoff, caption preflight validation and best-effort rollback, local custom preset schema validation, and Windows CI on Node.js 24. API-key protection remains encrypted local storage rather than OS credential-store integration; FFmpeg is detected from the system rather than bundled.

## v1.3.0 manual acceptance still required

Automated CI verifies tests, type checking, lint/type checking, production build output, and a basic compiled ExtendScript safety condition. It does **not** run Adobe After Effects. The following must be confirmed inside a real After Effects installation before treating the application behavior as fully verified:

1. Install the packaged ZXP in a clean user profile and confirm the panel opens.
2. Transcribe a short audio clip and a clip longer than the chunking threshold; compare transcript timing against the audio.
3. Edit text and timestamps, insert and remove words, then build captions. Confirm edited values are used and automatic onset refinement does not overwrite manual timing.
4. Generate representative presets with each support label. Inspect their native shapes, stacking order, timing, expressions, and final rendered appearance.
5. Exercise an invalid build request and inspect the composition to ensure preflight rejects it without changing existing layers.
6. Test a build failure if a safe reproducible way to trigger one is available; verify rollback removes only generated items and the user's original layers remain.
7. Test undo, repeated generation, a trimmed/stretched layer, and long compositions.
8. Export SRT, WebVTT, and JSON, open them in compatible tools, and verify text/timestamps.
9. Verify Arabic shaping, right-to-left layout, punctuation, font fallback, and mixed Arabic/Latin content in the target After Effects version.
10. Check cancellation during transcription/retry and ensure temporary audio is cleaned up.

This checklist is intentionally explicit: a green CI job is necessary, but it is not evidence that After Effects-only behavior has been manually confirmed.
