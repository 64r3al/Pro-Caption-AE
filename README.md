# Pro Caption AE

<div align="center">

### Turn speech into editable, animated captions—right inside After Effects.

Transcribe a voice track with Groq Whisper, refine every word and timestamp, choose a caption style, and build editable text layers in your composition.

[![Latest release](https://img.shields.io/github/v/release/64r3al/Pro-Caption-AE?display_name=tag&style=for-the-badge&color=7c5cff)](https://github.com/64r3al/Pro-Caption-AE/releases/latest)
[![Release downloads](https://img.shields.io/github/downloads/64r3al/Pro-Caption-AE/total?style=for-the-badge&color=20a779)](https://github.com/64r3al/Pro-Caption-AE/releases)
[![Stars](https://img.shields.io/github/stars/64r3al/Pro-Caption-AE?style=for-the-badge&color=f0b429)](https://github.com/64r3al/Pro-Caption-AE/stargazers)
[![License](https://img.shields.io/github/license/64r3al/Pro-Caption-AE?style=for-the-badge)](LICENSE)

**[Download Pro Caption AE](https://github.com/64r3al/Pro-Caption-AE/releases/latest) · [Installation guide](INSTALLATION.md) · [Report a problem](https://github.com/64r3al/Pro-Caption-AE/issues)**

</div>

> **Before you install:** You need After Effects 2024 or newer, FFmpeg, and your own Groq API key. The extension sends selected audio to Groq for transcription.

---

## At a glance

| | |
|---|---|
| **Host application** | Adobe After Effects 2024 (v24.0) or newer |
| **Operating systems** | Windows and macOS |
| **Audio processing** | FFmpeg, installed separately |
| **Transcription** | Groq Whisper Large v3 or Large v3 Turbo; bring your own API key |
| **Output** | Editable After Effects text layers in a generated precomposition |
| **License** | MIT |

### Project activity

The badges above show live GitHub release, download, star, and license information. Public repository data does **not** provide reliable visitor totals or the number of people actively using the extension. Stars, watchers, and downloads are not the same as users, so this README does not present them as user counts.

---

## What you can do

- **Transcribe selected footage or audio** with word-level timestamps.
- **Handle longer recordings** by splitting audio into overlapping chunks and stitching the results.
- **Refine timing** against the audio waveform, then adjust individual words and timestamps yourself.
- **Style captions** with 66 built-in presets, 15 motion types, installed fonts, and adjustable colors and placement.
- **See a measured waveform** for the selected source audio and follow transcript words along the timeline.
- **Build editable captions in After Effects** as text layers, grouped in a generated precomposition.
- **Export subtitles and transcripts** as SRT, WebVTT, or JSON.
- **Save custom styles locally** and reuse or delete them later.

Preset labels indicate whether a style uses native text motion, native shape treatments, or simplified output. Browser previews are representative; they are not guaranteed to match the final After Effects render pixel for pixel.

## Get started

### 1. Install the extension

1. Download the `.zxp` installer from [GitHub Releases](https://github.com/64r3al/Pro-Caption-AE/releases/latest).
2. Install it with [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/).
3. Restart After Effects and open **Window → Extensions → Pro Caption AE**.

Use the installer application to install the ZXP; dragging it directly into After Effects does not install the extension.

### 2. Install FFmpeg

Pro Caption AE uses FFmpeg to extract the selected audio, analyze its waveform, and process longer clips. Install FFmpeg and make sure it is available on your `PATH`, or choose its executable in the extension’s Settings.

- **Windows:** `winget install Gyan.FFmpeg` or `scoop install ffmpeg`
- **macOS:** `brew install ffmpeg`

### 3. Add your Groq API key

Create a key at [console.groq.com/keys](https://console.groq.com/keys), open **Settings** in the panel, and save your key. Use **Test** to check it.

### 4. Create captions

1. Open a composition and select one footage or audio layer that contains the voice.
2. In **Transcribe**, choose a Whisper model and, if needed, a language or glossary.
3. Transcribe the audio. Review and correct words or timestamps in the transcript editor.
4. Choose a preset and adjust the font, motion, colors, grouping, and placement.
5. Select **Build in AE** to create the caption layers in the composition.

For screenshots, troubleshooting, and the full install steps, see the [installation guide](INSTALLATION.md).

## Audio, privacy, and saved data

- The extension extracts audio from the selected layer and sends it to the **Groq transcription API** using the API key you provide. Do not transcribe sensitive media unless that use is appropriate for your organization and provider settings.
- Your API key is stored locally in encrypted settings on the machine. It is not stored in the After Effects project. This is local at-rest encryption, not an operating-system credential vault.
- Custom presets and font preferences are stored locally.
- Transcripts and manual transcript edits are held in the panel while it is open. **Export your transcript or build your captions before closing the panel**; project-backed transcript recovery is not currently included.

## Compatibility and current limitations

- Requires **After Effects 2024 (v24.0) or newer** and separately installed FFmpeg.
- The preview is a guide, not a pixel-perfect render of every After Effects treatment.
- Arabic casing is preserved, but right-to-left layout, shaping, mixed-direction punctuation, and word animation need verification in the target After Effects version.
- Transcript editing is word-level; group split/merge editing is not available.
- Full audio playback in the panel and a compact single-text-layer generator are not included.
- The ZXP build and automated checks can pass without exercising After Effects itself. Test installation, caption creation, undo, timing, and your chosen presets in your supported AE version before relying on them for important work.

## Troubleshooting

| Problem | Try this |
|---|---|
| The panel is missing | Restart After Effects and confirm you are using v24.0 or newer. |
| FFmpeg is not found | Install FFmpeg, restart After Effects, or select the executable in Settings. |
| The API key test fails | Check that the key is current and that the machine can reach Groq. |
| A layer cannot be transcribed | Select one audio-bearing footage layer. Precomps, solids, time-remapped layers, and reversed layers are not supported as sources. |
| A preset looks different in AE | Check its support label; some preview decorations are intentionally simplified in the generated output. |

If the issue persists, [open an issue](https://github.com/64r3al/Pro-Caption-AE/issues) with your operating system, After Effects version, steps to reproduce, and the error text. Do not include API keys or private media.

## For contributors

The panel is built with TypeScript, React, CEP, ExtendScript, and Vite. Shared timing, caption, transcript, and preset logic lives in `src/shared/`; After Effects host operations live in `src/jsx/`.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

The development panel can run in a browser with a mock host. That is useful for UI work, but it does not replace testing inside After Effects. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture and manual acceptance checklist.

## License and acknowledgements

Pro Caption AE is released under the [MIT License](LICENSE). Third-party components and notices are documented in [NOTICE.md](NOTICE.md).

<div align="center">

**Made for editors who want to spend less time keyframing captions and more time finishing the cut.**

[Releases](https://github.com/64r3al/Pro-Caption-AE/releases) · [Issues](https://github.com/64r3al/Pro-Caption-AE/issues) · [Source](https://github.com/64r3al/Pro-Caption-AE)

</div>

