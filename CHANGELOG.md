# Changelog

## 2.7.0 — 2026-11-11

- Add a reusable Japanese preset covering all 13 vocabulary fields, numeric JLPT export, ruby furigana, and preserved sentence highlighting.
- Add manual two-way Anki vocabulary sync with field-level conflict choices, note identity, local deletion tracking, recovery snapshots, and interrupted-export reconciliation.
- Review linked Word and Word Audio cards independently using Anki's scheduler, with explicit answer confirmation, cross-tab write coordination, and review-history checks after uncertain submissions.
- Preserve and preview Anki audio and pictures, upload selected local media, and include links and cached media in version 2 backups while retaining version 1 restore support.
- Keep original local review progress when linking; unlinking restores that progress. Restored links require verification before Anki review resumes.
- Add eight-language controls and isolated unit/browser fixtures. See `tests/ANKI-INTEGRATION.md` for setup and validation limits.

## 2.6.3 — 2026-10-20

- Speed up subtitle loading with staggered fallback transports and cancellation when tracks change.
- Share playback timing, remove full-track scans in subtitle gaps, reduce redundant rendering, and prioritize current-cue readings over off-screen transcript work.
- Cache repeated reading/translation requests, skip unnecessary kana dictionary requests, and show subtitle tokens before enrichment finishes.
- Calculate immersion difficulty from vocabulary in the main reading content, with separate script density, JLPT coverage, and mature/learning SRS statistics.
- Add an attributed offline JLPT vocabulary index and complete Unicode-based Hán-Việt fallbacks, including repairs for incomplete saved compounds.
- Improve selective furigana, dictionary import validation, popup startup, and the styling of page difficulty and offline dictionary controls.
- Add unit tests, browser fixtures, performance benchmarks, and packaged third-party notices.

Validation: 32 unit tests, TypeScript, and Chrome/Firefox production builds. The underlying changes also passed 23 local browser scenarios; details and limits are recorded in `tests/SUBTITLE-PERFORMANCE.md` and `tests/DENSITY-RESULTS.md`.
