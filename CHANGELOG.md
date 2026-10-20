# Changelog

## 2.6.3 — 2026-10-20

- Speed up subtitle loading with staggered fallback transports and cancellation when tracks change.
- Share playback timing, remove full-track scans in subtitle gaps, reduce redundant rendering, and prioritize current-cue readings over off-screen transcript work.
- Cache repeated reading/translation requests, skip unnecessary kana dictionary requests, and show subtitle tokens before enrichment finishes.
- Calculate immersion difficulty from vocabulary in the main reading content, with separate script density, JLPT coverage, and mature/learning SRS statistics.
- Add an attributed offline JLPT vocabulary index and complete Unicode-based Hán-Việt fallbacks, including repairs for incomplete saved compounds.
- Improve selective furigana, dictionary import validation, popup startup, and the styling of page difficulty and offline dictionary controls.
- Add unit tests, browser fixtures, performance benchmarks, and packaged third-party notices.

Validation: 32 unit tests, TypeScript, and Chrome/Firefox production builds. The underlying changes also passed 23 local browser scenarios; details and limits are recorded in `tests/SUBTITLE-PERFORMANCE.md` and `tests/DENSITY-RESULTS.md`.
