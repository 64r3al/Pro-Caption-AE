## Pro Caption AE v1.4.1

Reliability fixes for static previews, transcript recovery, settings, and FFmpeg discovery.

- Static grouped-caption previews no longer apply active-word highlighting or bounce scaling.
- Saving an After Effects project after transcription now attaches the current transcript to the saved project so later edits can recover.
- New transcript recovery records include the source media size and reject records when media at the same path changes size. Older records remain readable.
- FFmpeg PATH discovery is asynchronous, and failures saving API key or FFmpeg settings are shown in the panel.
- Settings writes use a temporary file followed by an atomic rename to reduce partial-write risk.
- Automated transcript-recovery tests cover same-path media size changes and legacy records.

### Important limits

- Automated CI does not run Adobe After Effects. Follow the manual acceptance checklist in [docs/ARCHITECTURE.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/docs/ARCHITECTURE.md#v141-manual-acceptance-still-required) before relying on the extension for important work.
- Legacy recovery records do not contain media-size fingerprints; they are accepted for compatibility and receive the stronger check on their next save.
- Media with the same path and size cannot be distinguished by this fingerprint alone.

Requires After Effects 2024 (v24) or newer and FFmpeg. See [INSTALLATION.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/INSTALLATION.md) for setup instructions.

---

## Pro Caption AE v1.4.0

Static caption output, optional stroke removal, and local transcript recovery.

- Adds **None (Static)** output mode. Generated captions keep their speech timing but omit text reveal, highlight, pop, and motion animation.
- Adds a **Text Stroke** control to remove a preset's outline from the preview and generated After Effects text. Presets without an outline show the control as unavailable.
- Saves transcripts and manual word/timing edits locally for a saved After Effects project, composition, selected layer, and source media. Matching work can be restored when the panel is reopened on the same machine and project path.
- Adds schema and source-identity validation for recovery records, with a clear size/storage error and JSON-export guidance when recovery cannot be saved.
- Sanitizes the uploaded audio filename so user-controlled paths cannot alter the Groq multipart header.
- Adds automated coverage for recovery identity, malformed data, path-case separation, filename sanitization, and custom preset persistence of static/no-stroke choices.

### Important limits

- Transcript recovery is stored in the local After Effects panel profile. It is not embedded in the `.aep` project, does not follow a project moved or renamed to another path, and is not synchronized to another machine. Export JSON for a portable backup.
- Automated CI checks tests, types, build output, and compiled ExtendScript safeguards. It does not run Adobe After Effects. Follow the manual acceptance checklist in [docs/ARCHITECTURE.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/docs/ARCHITECTURE.md#v140-manual-acceptance-still-required) before relying on the extension for important work.
- Preset support badges explain when browser-preview decorations are simplified in the generated composition.
- Arabic right-to-left layout, shaping, mixed-direction punctuation, and word animation still require acceptance testing in the target After Effects version.

Requires After Effects 2024 (v24) or newer and FFmpeg. See [INSTALLATION.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/INSTALLATION.md) for setup instructions.
