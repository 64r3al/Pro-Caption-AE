# Pro Caption AE

> AI transcription and animated, word-synced captions for Adobe After Effects.

Pro Caption AE is an After Effects panel that transcribes the audio in your comp with Groq's
Whisper API and builds frame-accurate, animated caption layers from it, styled with one of 66
presets built for short-form video, in any font installed on your machine.

## Install

1. Download the latest `.zxp` from [Releases](https://github.com/64r3al/Pro-Caption-AE/releases/latest).
2. Install it with the free [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/), then restart After Effects.
3. Open **Window → Extensions → Pro Caption AE** and add your [Groq API key](https://console.groq.com/keys) in Settings.

Requires After Effects 2024 (v24) or newer and FFmpeg. See [INSTALLATION.md](./INSTALLATION.md) for details.

## How to use

1. In your comp, select the audio (or video) layer you want captioned.
2. **Transcribe** tab: pick the model and language, optionally add glossary words (names, brands,
   jargon) so they're spelled right, then click **Transcribe**.
3. Pick a preset from the tray under the live preview, or browse all of them in the
   **Style & Animation** tab. In the **Kinetic Inspector** below the tray you can swap the
   **Animation** (15 motion types), pick any installed **Font**, and adjust size, words per group,
   bounce, colors and vertical position. The live preview updates as you go.
4. Click **Build in AE**. The captions are added as text layers in a `Captions - <comp name>`
   precomp, in a single undo step.

## Features

- **Groq Whisper transcription** (Large v3 or Large v3 Turbo) with word-level timestamps.
- **Long audio** is split into overlapping chunks automatically and stitched back together.
- **Onset refinement** nudges each word onto the actual start of the sound in your audio.
- **Frame-quantized timing** that respects the layer's start time, trim, and time stretch.
- **66 presets** for TikTok/Reels, YouTube, AMV, music, storytelling and a Kinetic Motion pack,
  plus word highlight, pop, reveal and drop shadow.
- **15 motion types** built as real After Effects text animators: slide up, drop in, side slide,
  grow, slam, blur focus, letter spread, skew, tilt, spin, squash, wave, shake, fade, hard cut.
- **Your fonts:** the font picker lists every font installed on your machine (After Effects
  2024+), previews each one in its own typeface, and remembers your choice.
- **Editable output:** normal After Effects text layers driven by expressions.
- **Transcript correction:** edit word text and timing, insert missing words, or remove unwanted words before building captions.
- **Real waveform analysis:** waveform peaks come from the selected source audio; click the timeline to seek the preview.
- **Subtitle export:** save the edited transcript as SRT, WebVTT, or structured JSON.
- **Custom presets:** save your current style locally, reapply it later, and remove custom presets you no longer need.
- **Preset support labels:** distinguish presets with native text motion, native shape treatments, or simplified text output.
- **Bring your own key:** your Groq key is stored encrypted in your user profile, never in the project.

**Important limitations:** the panel's animated preview is representative, not guaranteed to be pixel-identical to After Effects output. The waveform analyzes audio, but full audio playback and a data-driven single-text-layer generator are not part of v1.3.0. Arabic casing is preserved; full right-to-left rendering must be verified in After Effects.

## Stack

TypeScript · React · Tailwind CSS · CEP · ExtendScript · Groq Whisper API · FFmpeg · Vite

## Development

```bash
npm install
npm run dev        # panel UI in a plain browser at http://localhost:3000/main/index.html
npm test
npm run typecheck
npm run build      # dist/cep, symlinked into your CEP extensions folder for live testing
```

`npm run dev` runs without After Effects: a dev-only mock host answers layer-selection and build
calls with sample data, and adding `?gallery=1` to the URL opens a gallery of the UI components.
Neither is included in a packaged build.

### Releasing

The release workflow tests, builds, signs, and verifies the ZXP before publishing.

- To publish a new version automatically, merge the release-ready commit to `main`, then create/push a branch named exactly like the version tag (for example, `v1.3.0`). The workflow creates the matching tag and GitHub release. The branch and generated tag share a concurrency group to prevent a duplicate tag-triggered release run.
- You can also run **Release ZXP** from the Actions tab with a tag name.
- The version in `package.json` and `package-lock.json` must match the requested tag version (for example, `1.3.0` for `v1.3.0`).

See `docs/ARCHITECTURE.md` for how the pieces fit together.
