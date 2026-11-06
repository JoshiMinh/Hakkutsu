# Subtitle and lookup reading validation

Validated on 2026-11-06.

| Check | Result |
| --- | --- |
| `node --test tests/*.test.cjs` | 46 passed, including 14 new reading consistency tests |
| TypeScript (`tsc --noEmit`) | Passed |
| Chrome MV3 production build | Passed |
| Firefox MV2 production build | Passed |
| `/tests/subtitles.html` | 3/3 passed |
| `/tests/furigana.html` | 20/20 passed before the final definition-card guard |
| `/tests/furigana.html?test=Actual%20definition` | 1/1 passed after the guard, including conjugated versus dictionary-form readings |

The checks used local Node entrypoints because the pnpm launcher stalled at its supply-chain policy check. Browser checks ran in Chrome against Vite with disposable extension APIs, not against installed-extension data.

The regressions cover whitespace preservation, dictionary-confirmed conjugations, 来る alternation, reading alternatives, half-width/decomposed kana, supplementary kanji, 語 → NGỮ, sentence-reading transfer into lookup results, separate dictionary readings, request deduplication, and retries. The actual definition card shows 食べる with たべる when supplied, and suppresses the mismatched surface reading たべた when no lemma reading is available.

Automatic subtitle readings now use the installed dictionary and a small bundled vocabulary. They make no online definition or LLM requests; import a dictionary for broader coverage. Dictionary hover requests use the dictionary path, while explicit phrase analysis retains AI translation. Dictionary definitions can still use online providers.

Dictionary readings do not resolve every homograph from sentence meaning. The lookup preserves an available subtitle token reading, but unknown readings stay blank. Live YouTube/Netflix checks with the rebuilt, reloaded extension remain a separate integration check.
