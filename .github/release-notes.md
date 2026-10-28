## Pro Caption AE v1.3.0

Reliability, transcript editing, waveform analysis, and export improvements.

- Adds a bounded request timeout to Groq transcription calls, defensive response normalization, bounded retry delays, and cancellation during retry backoff.
- Validates word-level timestamps and uses validated segment-based timing only when usable word-level timestamps are unavailable.
- Adds tests for malformed transcript data, waveform peak compression, subtitle formatting, custom-preset validation, preset render-support labels, and language handling.
- Adds transcript word correction, insertion/deletion, and timestamp editing in the panel. Manual timing edits are preserved by skipping automatic onset refinement for edited transcripts.
- Replaces decorative waveform bars with peaks analyzed from the selected source audio and aligns the waveform to the selected layer's visible composition range.
- Adds SRT, WebVTT, and JSON transcript exports. Subtitle export uses the selected words-per-group and pause-splitting settings.
- Adds locally saved custom presets with validation, a schema version, a 100-preset cap, and delete support.
- Adds native After Effects shape treatments for selected card/accent presets and visible support labels explaining which presets are native shape treatments, native text motion, or simplified text approximations.
- Avoids forced uppercase for detected or explicitly selected Arabic transcripts.
- Improves API-key test error handling so the Settings panel does not remain stuck in a loading state.
- Adds preflight validation and best-effort cleanup of generated layers/precompositions when a caption build fails.
- Adds Windows CI for unit tests, type checks, production builds, and compiled ExtendScript sanity checks.
- Updates the release toolchain to Node.js 24 and verifies that the requested tag matches both package.json and package-lock.json.

### Known limitations

- The extension could not be exercised inside an installed Adobe After Effects session as part of this automated change. Before relying on it for important work, test caption creation, undo, new native shape treatments, long clips, and cancellation inside your supported After Effects version.
- Preset support badges intentionally disclose simplified output. They do not promise pixel-identical reproduction of every browser-preview decoration.
- Arabic text casing is preserved, but right-to-left paragraph layout, shaping, mixed-direction punctuation, and word animation still require real After Effects acceptance testing.
- The transcript editor edits individual words and timings; group-level split/merge editing and persistent project-backed transcript recovery are not included in this release.
- The compact single-text-layer/captions.json generator and a full audio-playback preview remain future work.

Requires After Effects 2024 (v24) or newer and FFmpeg. See [INSTALLATION.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/INSTALLATION.md) for details.
