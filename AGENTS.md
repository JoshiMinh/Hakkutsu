# AGENTS.md — Developer & AI Agent Guide

Technical architecture and engineering guidelines for **Hakkutsu** (v2.1.0).

---

## 1. Stack & Architecture

* **Framework:** [WXT](https://wxt.dev/) (Vite + TypeScript)
* **UI & Styling:** React 18, Lucide Icons, Custom CSS variables (`src/style.css`)
* **State & Storage:** Zustand (`src/lib/utils/settings.ts`), IndexedDB via [`idb`](https://www.npmjs.com/package/idb) (`HakkutsuDictDB`, `hakkutsu-srs`), `chrome.storage.local`
* **NLP & Rendering:** Kuromoji tokenizer (`kuromoji`, `kuroshiro`), `Intl.Segmenter` fallback, `hanzi-writer`
* **Target Platforms:** Chromium (Manifest V3) & Firefox (Manifest V2)

---

## 2. Directory Structure & Aliases

| Alias | Target Path | Purpose |
|---|---|---|
| `~components/*` | `src/components/*` | Shared UI components |
| `~lib/*` | `src/lib/*` | Services, utilities, locales, types |
| `~contents/*` | `src/contents/*` | Overlay & content script logic |
| `~style.css` | `src/style.css` | Design tokens & global CSS |
| `~/*` | `src/*` | Source root |

```text
src/
├── app.tsx, popup.tsx, options.tsx   # Dashboard, browser popup, options page
├── components/                       # UI: definition-card, srs-review, stats-overview, word-list, subtitle-overlay, kanji-breakdown
├── contents/                         # Content scripts: inline-dictionary, youtube-subtitles, netflix-subtitles, generic-subtitles
├── entrypoints/                      # WXT entrypoints (background.ts, app, popup, options, content scripts)
└── lib/
    ├── locales/                      # i18n dictionaries (en, ja, ko, vi, zh)
    ├── services/                     # Business logic: local-srs, local-lookup, local-tokenizer, dictionary-lookup, anki-connect, subtitle-parsers, video-runtime, tts-service
    └── utils/                        # Types, settings store, japanese text helpers, jlpt-classifier, hanviet-dict
```

---

## 3. Subsystem Specifications

* **Message Router (`src/entrypoints/background.ts`):** Typed `chrome.runtime.sendMessage` communication. `chrome.runtime.onMessage` handlers **must return `true`** for asynchronous `sendResponse`. Core types: `ANALYZE_TEXT`, `ADD_SRS_CARD`, `REMOVE_SRS_CARD`, `CHECK_CARD_EXISTS`, `EXPORT_ANKI`, `FETCH_TTS_AUDIO`, `CAPTURE_SCREENSHOT`.
* **Local SRS (`src/lib/services/local-srs.ts`):** IndexedDB database `hakkutsu-srs` (store: `cards`, indexes: `by-due-date`, `by-created-at`). Implements SM-2 scheduling (`interval`, `repetition`, `efactor`, `due_date`) with grades 1 (Again) through 4 (Easy) and 7-day forecast metrics.
* **Dictionary & NLP (`src/lib/services/local-tokenizer.ts`, `local-lookup.ts`):** IndexedDB database `HakkutsuDictDB` (store: `jmdict`, indexes: `kanji`, `reading`). Kuromoji morphological analysis with `Intl.Segmenter` fallback and clean `<ruby>` furigana distribution via [`distributeFurigana`](file:///c:/Users/binha/Projects/Hakkutsu/src/lib/utils/japanese.ts).
* **Subtitle Engine (`src/components/subtitle-overlay.tsx`, `src/lib/services/video-runtime.ts`):** Video time synchronization via `timeupdate` + 100ms interval fallback. Text deduplication via [`deduplicateCueText`](file:///c:/Users/binha/Projects/Hakkutsu/src/lib/services/subtitle-parsers.ts) and bounded token caches (`MAX_CACHE_SIZE = 100`).
* **Anki Bridge (`src/lib/services/anki-connect.ts`):** Direct HTTP POST bridge to local AnkiConnect at `http://127.0.0.1:8765` with user-configurable field mappings.

---

## 4. Commands & Guardrails

| Command | Action |
|---|---|
| `pnpm dev` | Start WXT development server with HMR |
| `pnpm typecheck` | Run TypeScript validation (`tsc --noEmit`) |
| `pnpm build` | Build Chrome MV3 extension (`.output/chrome-mv3`) |
| `pnpm build:firefox` | Build Firefox MV2 extension (`.output/firefox-mv2`) |
| `pnpm zip` | Package release zip archive |

### Agent Rules
1. **Zero Remote Backend:** All user data, vocabulary, and progress must remain in client-side storage (IndexedDB / `chrome.storage.local`).
2. **Cross-Browser Assets:** Always use `browser.runtime.getURL(...)` or `chrome.runtime.getURL(...)` for bundled assets inside content scripts.
3. **Lifecycle Cleanup:** Always unbind event listeners, timers, and observers in `useEffect` cleanup returns.
4. **Resilience & Fallbacks:** Preserve `ErrorBoundary` wrappers in main views and ensure dictionary fallback chains (`IndexedDB` $\rightarrow$ `Kuromoji` $\rightarrow$ `Intl.Segmenter`) remain unbroken.
5. **Type Safety:** Always verify modifications with `pnpm typecheck`.