# Web Extension Doctor: popup and settings redesign

Overall status: **PASS with warnings**. This is a targeted source/build audit, not store certification.

| Check | Status | Evidence / action |
| --- | --- | --- |
| TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit` |
| Browser builds | PASS | Chrome MV3 and Firefox MV2 production builds completed. Firefox excludes the Chromium-only offscreen permission. |
| Feature switches | PASS | Header switches persist Manga OCR, Streaming Subtitles, and AnkiConnect preferences. Disabled sections use native fieldsets; OCR unmounts its image controls and background OCR requests are rejected. Anki requests and exports respect the saved switch. |
| Storage compatibility | PASS | Verified defaults, legacy plain objects, Zustand JSON envelopes, and save/read round trips. Background settings now decode the UI's persisted format. |
| Localization | PASS | Matching translation keys across all eight locales; Streaming Subtitles renamed in each locale. |
| Keyboard access | PASS (source) | Named switches, labeled deck selects, pressed-state mode buttons, focus outlines, and arrow/Home/End navigation for popup tabs. Japanese IME composition does not submit text. |
| Isolation / IPC | PASS (source) | Injected interfaces use WXT Shadow DOM; background and OCR asynchronous message listeners return `true`. |
| Popup JavaScript | PASS | Approximately 16 KB popup entry plus a 350 KB shared chunk, below the skill's 800 KB budget. |
| Content JavaScript | WARN (P1) | Existing dictionary/subtitle bundles are approximately 483–492 KB each, above the skill's 400 KB budget. Follow-up: defer heavy dictionary/review dependencies in injected interfaces. |
| Host permissions | WARN (P1) | Generated manifests include `<all_urls>` for page dictionary/OCR and generic subtitles. Follow-up: consider optional site access while retaining universal lookup behavior. No additional permissions were added for this redesign. |
| Web-accessible resources | WARN (P1) | Existing `assets/*` and `ocr/*` resources match all URLs. Follow-up: split site-specific bridge declarations and expose only resources needed by content scripts. |
| Fonts | WARN (P2) | Existing stylesheet imports Google Fonts. Follow-up: bundle fonts locally or use the system font stack. |
| Package footprint | INFO | Actual Chrome output is approximately 11.8 MB uncompressed. WXT's displayed 36.27 MB total repeats OCR assets; it is not the actual disk footprint or ZIP size. |
| Visual/runtime verification | UNVERIFIED | No browser surfaces were available; the in-app browser was also unavailable. Inspect the rebuilt popup and settings in a loaded extension before release. |

Validation used the installed tool binaries because the PowerShell pnpm shim was blocked by execution policy and `pnpm.cmd` attempted dependency reinstallation. No dependencies or manifest permissions were changed.
