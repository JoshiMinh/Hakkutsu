# Anki integration validation

The Japanese preset requires Word, Word Reading, Word Furigana, Word Meaning, Word Audio, Vietnamese Sound, Sentence, Sentence Furigana, Sentence Meaning, Sentence Audio, JLPT, Notes, and Picture. Choose an existing deck and note type; enabling the preset does not import or modify notes by itself.

Vocabulary → Sync with Anki builds a read-only preview. Choose any field conflicts, then apply the selected entries. Imports bypass dictionary enrichment and generated examples. Existing links use note IDs within the active Anki profile; ambiguous initial matches require selection. No deletion crosses between apps. Hidden local entries can be explicitly selected for reimport. Anki templates and deck options are never rewritten.

The review source uses the `Word` and `Word Audio` template names. Sessions contain up to 50 due/new cards, due first, excluding suspended, buried, and filtered cards. Ordering and daily limits are Hakkutsu's session behavior, rather than Anki's native queue order. Anki handles each submitted rating and resulting schedule. There is no offline review queue and no historical local-review import. The aggregate local vocabulary status records maturity and due-now only; Anki day-number due values are never treated as Unix timestamps.

Each answer requires reveal and a confirmed API response before advancing. An uncertain submission remains pending; checking review history can confirm it without resubmitting. If there are multiple intervening reviews, check Anki and refresh instead of retrying automatically. Manual release is available only after checking an unrecorded operation. AnkiConnect has no transaction spanning profile switches, edits in Anki, and an answer, so avoid simultaneously reviewing the same card in both apps.

Before applying sync, Hakkutsu stores a recovery snapshot. The download includes local content/progress, cached media, sync state, and original Anki note values. Restore merges local data and marks links unverified; it never rolls back Anki automatically. First-link local review progress is also archived on the link and restored when unlinking. Version 1 backups remain supported. Only cached media is included; missing Anki media is reported and retained as a reference. Media uploads happen when a file is selected, before saving the vocabulary edit.

## Automated checks

- `node --test tests/*.test.cjs`: existing tests plus 16 Anki tests covering fields/ruby, three-way merge, duplicate note identities, repeated sync, stale previews, profile isolation, interrupted writes, pending-answer reconciliation, numeric ratings, missing notes, and original local-progress archival.
- `node node_modules/typescript/bin/tsc --noEmit`.
- `node node_modules/wxt/bin/wxt.mjs build` and `node node_modules/wxt/bin/wxt.mjs build -b firefox`.
- Start `node node_modules/vite/bin/vite.js --config tests/vite.config.ts`, then run `node scripts/test-anki-browser.mjs`. `CHROME_PATH` can override the Windows Chrome path. The runner uses a fresh browser profile, real IndexedDB and production React components, and a page-local simulated Anki API. It never contacts the user's Anki collection.
- Browser checks cover import/edit/export, conflict resolution, media upload/cache, sibling reviews, double-click protection, write locking, backup versions, restored-link verification, local deletion, HTML sanitization, dialog focus, and widths of 320/768/1024/1440 pixels. Results and screenshots are written under ignored `test-results/`.

The installed AnkiConnect API/source was inspected for compatibility. No notes, reviews, templates, or deck settings in the live collection were changed. Browser integration tests simulate the Anki server; they do not constitute a native Anki scheduling test. Firefox is production-build checked; the automated browser run uses Chrome.
