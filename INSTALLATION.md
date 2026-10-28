# Installing Pro Caption AE

## Requirements

- Adobe After Effects 2024 (v24.0) or newer, on Windows or macOS
- [FFmpeg](https://ffmpeg.org/download.html) installed (used to extract audio from your comp)
- A free [Groq API key](https://console.groq.com/keys)

## 1. Install the extension

1. Download `Pro-Caption-AE_<version>.zxp` from the [latest release](https://github.com/64r3al/Pro-Caption-AE/releases/latest).
2. Download and open the free **[ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/)** by aescripts + aeplugins.
3. Drag the `.zxp` file onto the installer window (or use **File → Open**) and wait for the success message.
4. Restart After Effects.
5. Open the panel from **Window → Extensions → Pro Caption AE**.

Dragging the `.zxp` into After Effects itself does not install it; use the installer above.

## 2. Install FFmpeg

The panel finds FFmpeg automatically if it is on your `PATH` or in a common install location.

- **Windows:** `winget install Gyan.FFmpeg` (or `scoop install ffmpeg`)
- **macOS:** `brew install ffmpeg`

If it is installed somewhere else, set its path in the panel's Settings.

## 3. Add your Groq API key

1. Create a key at [console.groq.com/keys](https://console.groq.com/keys).
2. In the panel, click the gear icon to open **Settings**.
3. Paste the key under **Groq API key**, save, and use **Test** to confirm it works.

The key is stored locally on your machine, per user.

## Using captions without motion or outlines

- In the style controls, choose **None (Static)** for plain text captions. The caption layers remain timed to the spoken words, but do not use reveal, highlight, pop, or text-motion animation.
- Turn off **Text Stroke** to remove the outline from a preset that has one. Presets without an outline have no stroke to remove.

## Transcript recovery

For a saved After Effects project, the panel stores the transcript and manual word/timing edits locally and can restore them for the matching project path, composition, selected layer, and source media. Recovery data stays in this machine's panel profile; it is not written inside the `.aep` project or synced to other machines. Save the project before transcription and export JSON when you need a portable backup.

## Troubleshooting

- **Panel missing from Window → Extensions:** fully quit and reopen After Effects, and confirm you are on v24 or newer.
- **Installer reports a signature error:** re-download the `.zxp` from the release page; a partially downloaded file fails verification.
- **"FFmpeg not found":** install it as above, or set its path in Settings.
- Anything else: [open an issue](https://github.com/64r3al/Pro-Caption-AE/issues) with your OS, After Effects version, and the error text.

## Uninstall

Open ZXP/UXP Installer, select Pro Caption AE in its list of installed extensions, and remove it.

## Building the ZXP yourself

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds and signs the ZXP on a Windows runner and attaches it to the release. To attach a ZXP to an existing release, run that workflow manually from the Actions tab with the tag name.

Locally (Windows or macOS only, since Adobe's signing tool is not available for Linux):

```bash
npm install
ZXP_PASSWORD=any-throwaway-value npm run zxp   # output: dist/zxp/com.procaptionae.panel.zxp
```
