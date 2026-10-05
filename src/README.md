# Source ownership

WXT and TypeScript resolve `~/` to `src/`. Import services and contracts directly
from their owner. There are no old-path forwarding modules or legacy aliases.

```text
src/
  entrypoints/                 WXT page names, HTML, registration, mounting
  app/                         Dashboard, popup, transcript shell, background router
  features/
    dictionary/                Lookup UI, definitions, Japanese analysis, dictionaries
    ocr/                       Image selection, crops, regions, recognition, offscreen worker
    anki/                      AnkiConnect, field mappings, export contracts
    analytics/                 Activity persistence, summaries, page density/furigana
    subtitles/
      shared/                  Cue parsing/timing, player helpers, transcript UI/state
      youtube/                 Page bridge, caption loading, overlay, player styles
      netflix/                 Page bridge, overlay, player styles
      generic/                 HTML5 discovery, compatible-site overlay, player styles
    vocabulary/                List/table, metadata editor, CSV, backup, history
    srs/                       Card database, scheduling, review UI, deck queries
    settings/                  Settings state/storage, cohesive views, Anki loading hook
  shared/
    ui/                        JLPT/frequency badges used across features
    browser/                   Message envelope and shared TTS/audio proxy
    japanese/                  Cross-feature language helpers and text normalization
    locales/                   Translation dictionaries and locale lookup
  styles/                      Resets, tokens, shared primitives, stylesheet composition
```

## Runtime boundaries

`entrypoints/background.ts` has an inline WXT startup callback that calls
`app/background.ts`. Keep that callback inline so WXT can discover metadata
without starting product services. The router delegates to each feature's
`messages.ts`; shared audio requests use `shared/browser/audio-messages.ts`.
The router retains navigation and listener-level sidebar handling: Chrome requires
`sidePanel.open()` synchronously within the user gesture. Transcript broadcasts
and offscreen OCR requests must not acquire a second responder here.

The OCR page only registers `features/ocr/offscreen.ts`. Recognition remains in
OCR, including packaged models/workers, crop geometry, evidence checks, dialogue
grouping, and the Firefox Worker fallback. Dictionary owns Japanese analysis and
the recognized-text correction/breakdown surface, and composes `MangaOcrImages`
for image selection. Its dictionary loading, tokenization, local fallbacks, and
network adapters stay together rather than becoming general browser APIs.

The legacy `FETCH_IMAGE` message serves two responsibilities. The router preserves
query precedence and dispatches illustration searches to dictionary and image URL
bytes to OCR. Both retain their existing response/error contracts.

Vocabulary owns display metadata and export/restore flows. It uses SRS cards but
does not own scheduling or review state. Settings owns persisted preferences and
feature configuration views. Analytics owns page density and selective furigana
injection because they serve its reading-density badge. The unused legacy kanji UI
and manga API contracts retain their dictionary/OCR owners rather than being
deleted during this layout change.

## Shared modules and styles

Shared Japanese helpers have real consumers in multiple features. Part-of-speech
labels and the POS badge remain in dictionary; Unicode ranges remain private to
the Japanese helper module. Text deduplication is shared because caption parsing
and dictionary translation already use identical normalization behavior. Hanzi
Writer's ambient declaration stays with its dictionary consumer.

Feature styles are beside their UI. `styles/global.css` is an ordered composition
sheet for extension pages and injected shadow roots. Its imports preserve the
existing cascade, including later overrides; do not casually reorder or combine
them. Only resets, tokens, and cross-feature primitives live under `styles/`.
Existing component-local styles and platform CSS strings remain colocated.

Netflix still includes the existing YouTube toolbar stylesheet before its native
player rules. This earlier-phase dependency deliberately preserves the exact
injected cascade; platform-specific player/bridge logic has not been merged.

Promote modules to `shared/` only after at least two independent features consume
their behavior. A shell consumer alone does not make a feature service shared.
Keep feature-only controls and data models with their owner.

Preserve IndexedDB names/versions/object stores, storage keys, runtime messages,
permissions, and bundled offline resources. Update literal source paths and
import mocks in `tests/` together with their owners.
