# Immersion density validation — 2.6.2

Validated on 2026-10-20. Existing furigana messages, subtitle analysis, and saved user data remain compatible.

| Check | Result |
| --- | --- |
| `node --test tests/*.test.cjs` | 16 passed |
| `/tests/furigana.html` | 20 browser scenarios passed |
| TypeScript | Passed |
| Chrome MV3 / Firefox MV2 production builds | Passed; version 2.6.2 |
| Panel widths | 320, 768, 1024, 1440 px; no horizontal panel overflow; 44px select |
| Source extraction | Inline spans/ruby stay contiguous; hidden text, UI, navigation, author prefaces/afterwords excluded |
| Dynamic changes | Hidden/unhidden content and navigation rescan; obsolete delayed responses cannot replace newer results |
| Data failures | Missing vocabulary and SRS data are shown as unavailable |
| License packaging | Vocabulary attribution and Mozilla Readability license included in both builds |
| `git diff --check` | Passed |

The density benchmark used 1,000 paragraphs containing 90,000 Japanese-script letters (50,000 word occurrences). Two scans took **59ms** on this machine with timer progress during processing. This is a local benchmark, not a universal latency guarantee. The existing furigana benchmark also passed with 4,000 rubies and no recorded long tasks.

## Public-page replay checks

The browser harness replayed captured HTML with scripts, external resources, and event handlers removed. These checks exercise the actual analyzer and panel; they do not constitute a test of the installed extension on a live site or of that site's original CSS.

| Captured page | Scope | Words / unique | JLPT coverage (rounded) | Script density (rounded) |
| --- | --- | --- | --- | --- |
| [Syosetu chapter](https://ncode.syosetu.com/n2386hb/1/) | Chapter body | 825 / 387 | 45% | 100% |
| [MDN Japanese/English introduction](https://developer.mozilla.org/ja/docs/Web/JavaScript/Guide/Introduction) | Article | 1,860 / 507 | 46% | 76% |

Both correctly suppress a headline JLPT level because coverage is below 70%. The Syosetu result matches a direct scan of the chapter text container. SRS is deliberately unavailable in this replay; it has no access to extension-owned cards.

To repeat: run `python scripts/capture-density-pages.py`, start `node node_modules/vite/bin/vite.js --config tests/vite.config.ts`, and open `/tests/density-manual.html` or `/tests/density-manual.html?page=mixed`. Captures stay in ignored `.cache/`; preview-only sample data is marked in the panel style preview.

## Classification boundaries

The bundled index contains 13,918 normalized expression/reading aliases, including 533 ambiguous aliases left unranked. Source revision and CSV SHA-256 hashes are recorded in `density-jlpt.source.json`; regenerate with `python scripts/generate-density-jlpt.py`.

Levels are community vocabulary estimates. Ambiguous forms, unmatched vocabulary, and unresolved grammatical forms remain unranked. Han script also occurs outside Japanese, so the character ratio is explicitly labeled script density. Familiarity reflects saved SRS state, not an assertion about everything the reader knows.
