<div align="center">
  <img src="public/assets/icon.png" alt="Hakkutsu Logo" width="128" height="128" style="border-radius: 16px;" />

  # Hakkutsu (発掘)
  **Local-First Japanese Immersion & Sentence Mining Extension**

  [Add to Chrome Web Store](https://chromewebstore.google.com) • [Support on Ko-fi](https://ko-fi.com/joshiminh) • [Privacy Policy](privacy.html)
</div>

---

## 🌟 Overview

**Hakkutsu** (発掘, meaning *"excavation"* or *"discovery"*) is a free, local-first browser extension for Japanese language learners. It brings dictionary lookups, furigana readings, pitch accent indicators, SRS reviews, and 1-click AnkiConnect sentence mining directly into the web pages and videos you visit.

Built on **WXT (Web Extension Tools)** and **Vite**, Hakkutsu delivers lightning-fast performance with zero tracking and full offline capabilities.

---

## ✨ Key Features

- 📖 **Instant Offline Lookup**: Hover or select Japanese text on any web page to display definitions, pitch accent graphs, furigana readings, and JLPT difficulty badges.
- 🎴 **1-Click AnkiConnect Mining**: Export target vocabulary, example sentences, audio pronunciation, and contextual definitions directly to your local Anki desktop software.
- 🎬 **Video Subtitle Immersion**: Study with interactive dual subtitles on YouTube, Netflix, third-party sites, and custom HTML5 video players with hover-to-pause lookups.
- 🧠 **Built-in SRS & Visualizations**: Review saved vocabulary on schedule using the built-in Spaced Repetition System. Track learning progress with charts, review analytics, and kanji stroke order diagrams.
- 🔒 **100% Local & Privacy-First**: Operates completely offline on your device with zero telemetry, zero analytics, no external servers, no account required, and zero data tracking.
- 💖 **Completely Free**: No subscriptions, no payment required, no paywalls, and no ads.

---

## 📸 Extension Screenshots

| 01. Dictionary Lookup | 02. Extension Popup |
| :---: | :---: |
| ![Dictionary Lookup](screenshots/01-dictionary-lookup.jpg) | ![Extension Popup](screenshots/02-popup.jpg) |

| 03. Video Subtitles | 04. SRS Flashcards |
| :---: | :---: |
| ![Video Subtitles](screenshots/03-video-subtitles.jpg) | ![SRS Review](screenshots/04-srs-review.jpg) |

---

## 🛠️ Development & Building

Hakkutsu uses **`pnpm`** and **WXT** (powered by Vite).

### Prerequisites
- Node.js 18+
- pnpm 8+

### Setup & Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Start dev server with Live HMR
pnpm dev

# 3. Build Chrome MV3 production bundle (.output/chrome-mv3)
pnpm build

# 4. Build Firefox MV3 production bundle (.output/firefox-mv3)
pnpm build:firefox

# 5. Package web store .zip releases
pnpm zip

# 6. Typecheck TypeScript
pnpm typecheck
```

---

## 📂 Project Architecture

```text
Hakkutsu/
├── public/                 # Static extension assets (single canonical location)
│   └── assets/             # Icons, logos, language flags
├── src/
│   ├── components/         # React UI components (cards, pitch accent, SRS)
│   ├── contents/           # Content script React overlays & bridge modules
│   ├── entrypoints/        # WXT extension entry points
│   │   ├── background.ts   # MV3 service worker
│   │   ├── popup/          # Extension popup UI
│   │   ├── options/        # Extension settings page
│   │   ├── app/            # Full-page Learning Hub dashboard
│   │   ├── offscreen/      # Offscreen document for heavy processing
│   │   └── *.content.tsx   # Shadow DOM content script mounting wrappers
│   └── lib/                # Japanese tokenizer, dictionary, Anki, SRS engines
├── wxt.config.ts           # WXT & Vite configuration
└── tsconfig.json           # TypeScript configuration
```

---

## 🔒 Privacy Policy

Hakkutsu is built privacy-first:
- All text processing and dictionary lookups take place 100% locally on your machine.
- User settings and saved vocabulary items are stored exclusively on your device.
- Anki synchronization connects directly to your local Anki desktop software (`http://localhost:8765`).
- No personal data, browsing history, or metrics are ever collected or transmitted.

Read the full [Privacy Policy](privacy.html) for detailed disclosures.

---

## 💙 Support & Feedback

If Hakkutsu helps you enjoy reading and learning Japanese, consider supporting ongoing open-source development:

- **Support on Ko-fi**: [ko-fi.com/joshiminh](https://ko-fi.com/joshiminh)

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
