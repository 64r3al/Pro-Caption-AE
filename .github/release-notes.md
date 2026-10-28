## Pro Caption AE v1.3.0

Reliability and release-quality improvements.

- Adds a bounded request timeout for Groq transcription calls.
- Validates word-level transcription timestamps and uses a validated segment fallback when needed.
- Adds tests for malformed transcript timing and whitespace handling.
- Improves API-key test error handling so the Settings panel does not remain stuck in a loading state.
- Adds preflight validation to caption generation and best-effort rollback of generated layers/precompositions when a build fails.
- Adds Windows CI for tests, type checks, production builds, and compiled ExtendScript checks.
- Updates the release toolchain to Node.js 24 and verifies that the package version matches the requested release tag.

Requires After Effects 2024 (v24) or newer and FFmpeg. See [INSTALLATION.md](https://github.com/64r3al/Pro-Caption-AE/blob/main/INSTALLATION.md) for details.
