# Hakkutsu 2.6.2 validation — 2026-10-20

| Check | Result |
| --- | --- |
| Automated tests (`node --test tests/furigana.test.cjs`) | 10 passed |
| Browser harness `/tests/furigana.html` | 18 passed |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed, Chrome MV3 |
| `pnpm build:firefox` | Passed, Firefox MV2 |
| `git diff --check` | Passed |
| Popup preview | Rendered at 320 × 600 and 440 × 600; no recorded console errors |
| Dictionary settings redesign | Fits 320, 375, 414 and 768 px viewports; 44 px import button; no preview console errors |
| Release manifests | Chrome and Firefox both report 2.6.2 |
| Unicode license | Included in both built extensions |
| Page difficulty redesign | Responsive at 320/375/414/768 px; complete distribution including unranked kanji; Escape/outside dismissal and focus restoration passed |

The final TypeScript and build checks used the local Node entrypoints (`node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/wxt/bin/wxt.mjs build [-b firefox]`) because the pnpm launcher stalled during its supply-chain policy check.

The actual DefinitionCard components render `便利 → TIỆN LỢI` even with an old partial `LỢI` value, and `連載 → LIÊN TẢI` with no saved value. Browser tests also verify the Hán-Việt visibility setting. Unit tests cover kana-only lemma fallback, compatibility/shinjitai characters, iteration marks, missing-character handling, and complete supplied polyphonic readings. Existing collection data is not batch-rewritten; missing/partial display values are resolved at read time, and newly saved cards use the shared resolver.

Follow-up screenshot regression: `棄` was still absent from the generated base, hiding the complete badge for `破棄`. Added a verified override and confirmed the actual DefinitionCard renders `PHÁ KHÍ` with either no supplied reading or an old partial `PHÁ`. Related `棄却 → KHÍ KHƯỚC` and kana-lemma fallback are covered by unit assertions. All 10 automated tests, 18 browser tests, TypeScript validation, and both production builds passed again.

The browser harness exercised the production injector with real DOM, MutationObserver, and deterministic extension messages. It also exercised real IndexedDB imports, the actual badge's failure/retry/cancel/rescan behavior, and the Settings file importer. The Node tests exercised the production reading resolver, modes, chunking, background message handler, and import validation/rollback handling.

## Synthetic chapter benchmark

1,000 repeated paragraphs, 12,000 source characters, 4,000 generated ruby elements:

| Measurement | Observed |
| --- | --- |
| First annotation | 28 ms |
| Complete injection | 276 ms |
| Removal and text restoration | 53 ms |
| Batched reading messages | 1 |
| Fixture dictionary lookups | 6 |
| Timer heartbeat callbacks during injection | 7 |
| Recorded long tasks | 0 |

The tab reported visible. These are single-run fixture measurements with a small in-memory dictionary, not production dictionary latency or a general speedup claim. Repeated paragraphs deliberately exercise deduplication. The original injector aborted before querying its dictionary, so it did not provide a meaningful working performance baseline.

## Remaining live verification

The browser tools used here do not expose loading/reloading unpacked extensions or the extension toolbar popup. The popup was verified as a local preview of its real components with disposable browser APIs. The original black toolbar panel was not reproduced in an installed extension.

Reload `.output/chrome-mv3` or `.output/firefox-mv2`, import the local dictionary through Settings, and check Syosetu plus a long chapter. Confirm toolbar sizing, lookup, selection, links, scrolling, and furigana enable/disable in each installed browser. Context-dependent readings still depend on the supplied dictionary and local token refinement; this is not a contextual pronunciation model.
