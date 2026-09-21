# AGENTS.md — Developer & AI Agent Guide (Hakkutsu v2.1.0)

Technical architecture, subsystem specifications, developer guardrails, and diagnostic protocols for **Hakkutsu**.

---

## 1. Stack & Architecture

* **Framework & Build:** [WXT](https://wxt.dev/) (Vite + TypeScript)
* **UI & Styling:** React 18, Lucide Icons, Custom CSS variables & Design Tokens (`src/style.css`)
* **State Management:** Zustand (`src/lib/utils/settings.ts`) with `chrome.storage.sync` persistence
* **Local Storage & Databases:**
  * IndexedDB database `hakkutsu-srs` (store: `cards`, indexes: `by-due-date`, `by-created-at`)
  * IndexedDB database `HakkutsuDictDB` (store: `jmdict`, indexes: `kanji`, `reading`)
  * `chrome.storage.local` for secondary cache and history
* **NLP, Morphology & Rendering:**
  * Kuromoji tokenizer (`kuromoji`, `kuroshiro`) with `Intl.Segmenter` fallback
  * Clean `<ruby>` furigana distribution via `distributeFurigana`
  * `hanzi-writer` for stroke-order diagrams
* **SRS Engine:** Modern **FSRS-4.5 / 5** (DSR memory model: Difficulty $D$, Stability $S$, Retrievability $R$) + classic **SM-2** fallback
* **Target Platforms:** Dual target: Chromium (Manifest V3) & Firefox (Manifest V2)

---

## 2. Directory Structure & Aliases

| Alias | Target Path | Purpose |
|---|---|---|
| `~components/*` | `src/components/*` | Shared UI components & views |
| `~lib/*` | `src/lib/*` | Services, utilities, locales, types |
| `~contents/*` | `src/contents/*` | Overlay & content script logic |
| `~style.css` | `src/style.css` | Design tokens & global CSS |
| `~/*` | `src/*` | Source root |

```text
src/
├── app.tsx, popup.tsx, options.tsx     # Dashboard hub, browser popup, options page
├── components/                         # UI: definition-card, srs-review, stats-overview, word-list, 
│                                       # subtitle-overlay, kanji-breakdown, activity-heatmap, immersion-density-badge
├── contents/                           # Content scripts: inline-dictionary, youtube-subtitles, netflix-subtitles, generic-subtitles
├── entrypoints/                        # WXT entrypoints (background.ts, app, popup, options, content scripts)
└── lib/
    ├── locales/                        # 5-Language i18n dictionaries (en, vi, ja, ko, zh)
    ├── services/                       # Business logic: local-srs, fsrs-engine, local-lookup, local-tokenizer, 
    │                                   # dictionary-lookup, anki-connect, subtitle-parsers, video-runtime, tts-service, analytics-service
    └── utils/                          # Types, settings store, japanese text helpers, jlpt-classifier, hanviet-dict
```

---

## 3. Subsystem Specifications

### A. Message Router (`src/entrypoints/background.ts`)
* Typed `chrome.runtime.sendMessage` communication between content scripts, popup, and options page.
* Asynchronous message handlers **must return `true`** in `chrome.runtime.onMessage.addListener`.
* Core message types: `ANALYZE_TEXT`, `ADD_SRS_CARD`, `REMOVE_SRS_CARD`, `CHECK_CARD_EXISTS`, `EXPORT_ANKI`, `FETCH_TTS_AUDIO`, `CAPTURE_SCREENSHOT`, `FETCH_IMAGE`, `TRACK_CHARACTERS_READ`, `TRACK_VIDEO_IMMERSION`, `GET_IMMERSION_ANALYTICS`, `RESET_LEECH_STATUS`, `GET_SMART_DECK_FILTERS`.

### B. FSRS-4.5/5 & Local SRS Engine (`src/lib/services/fsrs-engine.ts`, `local-srs.ts`)
* **DSR Memory Model:**
  * Retrievability: $R(t, S) = (1 + \frac{19}{81} \cdot \frac{t}{S})^{-0.5}$
  * Target Retention Interval: $I(r, S) = \frac{S}{19/81} \cdot (r^{-2} - 1)$
  * Ratings: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy).
  * States: 0 (New), 1 (Learning), 2 (Review), 3 (Relearning).
* **Leech Management:** Automatically flags cards failing review $\ge \text{srsLeechThreshold}$ (default: 4 lapses) for targeted retraining.
* **Smart Decks:** Multi-attribute filtering by JLPT level (`N5`–`N1`), source domain (`YouTube`, `Netflix`, etc.), custom tags, and due/leech status.

### C. Audio-First Review Experience (`src/components/srs-review.tsx`)
* When Audio-First mode is active, the Japanese text on the front card is masked with a soundwave pulse animation.
* Japanese TTS audio auto-plays on card load.
* <kbd>R</kbd> keyboard shortcut replays audio at any time.
* <kbd>Space</kbd> or <kbd>Enter</kbd> reveals `<ruby>` furigana, reading, definition, Sino-Vietnamese (Hán-Việt), illustration image, sentence context, and FSRS metrics ($S$, $R$).

### D. Subtitle Engine & Video Runtime (`src/components/subtitle-overlay.tsx`, `video-runtime.ts`)
* Time synchronization via video element `timeupdate` + 100ms interval fallback.
* Text deduplication via `deduplicateCueText`.
* Bounded token analysis cache (`MAX_CACHE_SIZE = 100`).
* Universal HTML5 video player detection and runtime mounting across generic websites.

### E. Web Immersion & Selective Furigana (`src/lib/services/page-analyzer.ts`, `furigana-injector.ts`)
* Analyzes webpage Japanese text density and JLPT composition ($N5-N1$).
* Selectively injects `<ruby>` furigana annotations into the DOM based on user study level (`unlearned`, `n3_plus`, `n2_plus`, `n1_only`, `all`).

### F. Anki Bridge (`src/lib/services/anki-connect.ts`)
* Direct HTTP POST bridge to local AnkiConnect at `http://127.0.0.1:8765`.
* Configurable field mappings (word, reading, furigana HTML, meaning, Sino-Vietnamese, audio, screenshot, sentence context).

---

## 4. Hakkutsu Doctor — Built-in Diagnostic Protocols

Whenever requested to run diagnostics, health checks, or validation on the codebase, execute this standard protocol:

### Step 1: Type Validation
```bash
pnpm typecheck
```
* Must exit with code 0 (0 TypeScript errors).

### Step 2: Dual Target Production Builds
```bash
pnpm build          # Chromium MV3 (.output/chrome-mv3)
pnpm build:firefox  # Firefox MV2 (.output/firefox-mv2)
```
* Verify both targets compile assets, manifest, background service worker, and content scripts without warnings.

### Step 3: 5-Language i18n Parity Audit
* Verify that all translation keys in `src/lib/locales/en.ts` exist with matching keys in:
  * `src/lib/locales/vi.ts` (Vietnamese)
  * `src/lib/locales/ja.ts` (Japanese)
  * `src/lib/locales/ko.ts` (Korean)
  * `src/lib/locales/zh.ts` (Chinese)

### Step 4: Memory Leak & Event Listener Lifecycle Audit
* Inspect all `useEffect` hooks in content scripts and UI components:
  * Window/document `keydown` listeners must be removed in cleanup returns.
  * DOM `MutationObserver` and `ResizeObserver` instances must be disconnected.
  * Video `timeupdate` and `ratechange` listeners must be unbound.
  * Timers (`setInterval`, `setTimeout`) must be cleared.

### Step 5: Design Token & Theme Contrast Verification
* Inspect `src/style.css` for consistent design token variables (`--hk-bg-*`, `--hk-text-*`, `--hk-accent-*`, `--hk-jlpt-*`).
* Ensure text-to-background contrast adheres to WCAG AA/AAA standards in both dark and light modes.

### Step 6: Local-First Privacy & Zero Remote Backend Guardrail
* Ensure **zero user flashcards, learning history, or private data** are sent to any external server.
* All cards and reviews remain strictly client-side in IndexedDB (`hakkutsu-srs`).

---

## 5. Commands & Engineering Guardrails

| Command | Action |
|---|---|
| `pnpm dev` | Start WXT development server with Hot Module Replacement |
| `pnpm typecheck` | Run TypeScript validation (`tsc --noEmit`) |
| `pnpm build` | Build Chrome MV3 extension (`.output/chrome-mv3`) |
| `pnpm build:firefox` | Build Firefox MV2 extension (`.output/firefox-mv2`) |
| `pnpm zip` | Package release zip archive |

### Core Agent Rules
1. **Zero Remote Backend:** All user data, vocabulary, and SRS statistics must remain in client-side storage (IndexedDB / `chrome.storage`).
2. **Cross-Browser Assets:** Always use `browser.runtime.getURL(...)` or `chrome.runtime.getURL(...)` for bundled assets inside content scripts.
3. **Lifecycle Cleanup:** Always unbind event listeners, timers, and observers in `useEffect` cleanup returns.
4. **Resilience & Fallbacks:** Preserve `ErrorBoundary` wrappers in main views and ensure dictionary fallback chains (`IndexedDB` $\rightarrow$ `Kuromoji` $\rightarrow$ `Intl.Segmenter`) remain unbroken.
5. **Type Safety:** Always verify modifications with `pnpm typecheck`.
