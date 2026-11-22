# Changelog

## 2.8.1 — 2026-11-22

- Keep the lookup popup above YouTube comments and restore its page placement when leaving fullscreen.
- Expand offline Hán-Việt coverage by 6,709 characters, including Japanese kanji variants such as 実. 確実 now displays XÁC THỰC.

## 2.8.0 — 2026-11-17

- Analyze full sentence selections with translation and clickable words, including keyboard selection, frames and open shadow roots.
- Keep lookup results and errors consistent across eight languages, including language changes during analysis.
- Remove the duplicate divider below dictionary headwords and update store information and privacy disclosures.

## 2.7.2 — 2026-11-16

- Keep lookup headers, errors, translations, definitions and cached results consistent with all eight UI languages, including language changes during analysis. Check locale keys and placeholders automatically.
- Support keyboard selections and selections inside open shadow roots, with regression checks for inline lookups, panels and framed pages.
- Analyze the complete text selected by dragging, including double-click drags and triple-click selections, and show its translation with a clickable sentence breakdown.
- Keep short phrases on the sentence-tokenization path instead of accepting a related dictionary result as the meaning of the whole phrase. Preserve sentence tokens when translation is unavailable or analysis falls back locally.
- Prevent pending hover lookups and older responses from replacing a selection; retain full sentence context when saving a selected word.

## 2.7.1 — 2026-11-12

- Match Anki sync, review, and field settings to the existing theme, with localized feedback, accessible selectors, compact 50-row previews, and fixed dialog controls.
- Correct filtered-deck searches and support stopping preview or sync safely after the current note. Report completed, failed, and untouched entries separately and resume through a fresh preview.
- Save learned-word bold formatting locally for sentence fields, preserving ruby and original Anki baselines. Existing saved entries are repaired locally; Anki changes remain visible in the next manual sync preview.
- Add independent word and sentence recording buttons to vocabulary cells, sequential playback, cached/profile-scoped media, and cleanup when switching rows or leaving the view. No speech generation is used.
- Keep progress-refresh failures separate from note failure counts, scope sync preview media to its original profile, and defer hidden detail media until expanded.
- Add limit regression checks covering exhausted dictionary lookup budgets, long sentence/ruby fields, incomplete responses, and imports spanning multiple pages and read batches.

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
