# Chrome Web Store Listing — Hakkutsu: Japanese Immersion & Dual Subtitles

> Last Updated: 2026-10-03

## Store Listing

**Extension Name** [REQUIRED]
Hakkutsu — Japanese Immersion & Dual Subtitles

**Short Description** [REQUIRED]
Learn Japanese while browsing, watching YouTube & Netflix with instant dictionary lookups, dual subtitles, and spaced repetition.

**Detailed Description** [REQUIRED]
Hakkutsu is an all-in-one Japanese immersion tool that helps you learn vocabulary, grammar, and kanji naturally while reading articles, reading manga, and watching your favorite videos.

Immerse yourself directly in Japanese content without breaking your flow:

DUAL SUBTITLES FOR YOUTUBE & NETFLIX
• Watch Japanese videos with smart interactive dual subtitles.
• Hover over any subtitle word to instantly see its reading, pitch accent, JLPT level, and definition.
• Automatic phrase alignment keeps Japanese and target-language captions in sync.
• Interactive side panel transcript lets you follow dialogue line-by-line, search for spoken words, and jump directly to any cue.

INSTANT INLINE DICTIONARY & FURIGANA
• Select or hover over Japanese text on any website to see definitions, kanji breakdowns, and grammar explanations.
• Clean furigana annotations above kanji help you practice reading without squinting or guessing.
• Audio pronunciation for target words and sentences.
• Animated kanji stroke order diagrams to master writing.

INTEGRATED SPACED REPETITION (SRS) & ANKI SYNC
• Add vocabulary and contextual sentence cards with a single click.
• Audio-first and cloze recall review modes train your listening and comprehension.
• Modern memory scheduling ensures you review words right when you are about to forget them.
• Direct one-click export to your local Anki collection with rich cards containing readings, audio, and example sentences.

MANGA & IMAGE OCR
• Read Japanese manga and comics directly in your browser.
• Optical character recognition automatically detects speech bubbles and vertical text.
• Click speech bubbles to look up words instantly without typing.

HOW TO USE
1. Click the Hakkutsu extension icon to open quick lookup or adjust settings.
2. When reading Japanese on the web, highlight any word or hold Ctrl while hovering to inspect it.
3. When watching videos on YouTube or Netflix, dual subtitles and transcript tools activate automatically.
4. Click the "+" button on any word definition to save it to your review deck or export it to Anki.

PRIVACY FIRST — ZERO TRACKING
Hakkutsu operates entirely on your device. Your vocabulary lists, flashcards, learning history, and review progress stay private and are stored strictly on your local machine. No account creation, no analytics tracking, and no external servers.

SUPPORT & COMMUNITY
• Open source: MIT License
• Feedback & Bug Reports: https://github.com/
• Support on Ko-fi: https://ko-fi.com/joshiminh

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Helps users learn Japanese by providing instant inline dictionary lookups, dual subtitles, and spaced repetition flashcards directly on web pages and videos.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `public/icon-128.png` |
| Extension Icon (Toolbar) | 16×16 PNG | ✅ Ready | `public/icon-16.png` |
| Extension Icon (Menu) | 32×32 PNG | ✅ Ready | `public/icon-32.png` |
| Extension Icon (Display) | 48×48 PNG | ✅ Ready | `public/icon-48.png` |
| Extension Icon (HiDPI) | 512×512 PNG | ✅ Ready | `public/icon-512.png` |
| Screenshot 1 (Subtitles) [REQUIRED] | 1280×800 | ⬜ Pending capture | Video player with interactive dual subtitles & transcript sidebar |
| Screenshot 2 (Inline Dict) [RECOMMENDED] | 1280×800 | ⬜ Pending capture | Web article with inline dictionary popup & furigana annotations |
| Screenshot 3 (SRS Reviews) [RECOMMENDED] | 1280×800 | ⬜ Pending capture | Spaced repetition review card with audio pulse & cloze deletion |
| Screenshot 4 (Manga OCR) | 1280×800 | ⬜ Pending capture | Manga reader with speech bubble text selection & lookup dialog |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Pending capture | Visual banner showing Hakkutsu branding & key features |
| Marquee Promo Tile | 1400×560 | ⬜ Pending capture | Wide banner showing video subtitles & immersion dashboard |

### Screenshot Notes
- **Screenshot 1**: Capture YouTube or Netflix player running Japanese dual subtitles with the interactive sidepanel transcript opened on the right.
- **Screenshot 2**: Show a Japanese news article or Wikipedia page with a clean Hakkutsu lookup card displaying JLPT tag, furigana, and definitions.
- **Screenshot 3**: Show the SRS review dashboard with the audio-first soundwave pulse and rating buttons (Again, Hard, Good, Easy).
- **Screenshot 4**: Show a manga page with speech bubbles recognized by the local OCR engine and the breakdown popover.

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Saves user preferences, UI customization, review settings, and offline dictionary cache locally in browser storage. |
| `tabs` | permissions | Reads the current video or article tab URL and title to attach source context to saved vocabulary flashcards and synchronize dual subtitle tracks. |
| `activeTab` | permissions | Grants instant temporary access to the active webpage to inspect selected Japanese text when the user clicks the toolbar popup. |
| `scripting` | permissions | Injects lightweight video detection helpers to identify embedded HTML5 video players on websites with Japanese video content. |
| `offscreen` | permissions | Runs local optical character recognition (OCR) inside an isolated offscreen document for manga images without freezing the UI or browser tabs. |
| `sidePanel` | permissions | Renders the interactive Video Script / Transcript panel alongside streaming videos for line-by-line subtitle reading and search. |
| `https://*/*` | host_permissions | Enables inline dictionary popups, furigana injection, and subtitle synchronization across arbitrary Japanese web pages and streaming platforms. |
| `http://localhost:8765/*` | host_permissions | Connects to the local AnkiConnect desktop bridge to allow one-click export of flashcards directly into the user's local Anki deck. |
| `http://localhost:3000/*` | host_permissions | Allows connecting to optional local development and self-hosted dictionary API servers configured by the user. |
| `http://localhost:8000/*` | host_permissions | Allows connecting to optional local AI and translation servers configured by the user. |
| `http://127.0.0.1:8000/*` | host_permissions | Allows connecting to optional local AI and translation servers running on loopback IP. |

---

## Privacy & Data Use

### Data Collection
- **Personal Information**: None collected.
- **Health Information**: None collected.
- **Financial Information**: None collected.
- **Authentication Information**: None collected.
- **Personal Communications**: None collected.
- **Location**: None collected.
- **Web History**: Not collected or stored remotely. URLs are used purely on-device to attribute source context to flashcards saved by the user.
- **User Activity**: Stored strictly on-device in local IndexedDB. Never transmitted.
- **Website Content**: Text selections on web pages are processed on-device (Kuromoji / JMDict) or via user-initiated translation/dictionary requests. No webpage text is ever logged, aggregated, or sold.

### Local-First Guarantee
All flashcards, SRS review scheduling, learning streak records, and saved vocabulary are stored strictly within client-side IndexedDB databases (`hakkutsu-srs` and `HakkutsuDictDB`). The extension contains zero tracking analytics and zero remote telemetry.

---

## Version History

### Version 2.3 (Current) — 2026-10-03
- Corrected icon asset dimensions across all manifest targets (16×16, 32×32, 48×48, 128×128, 512×512).
- Hardened Web Accessible Resources scoping: restricted YouTube and Netflix bridge scripts to their respective domain match patterns to prevent third-party extension fingerprinting.
- Fixed furigana reading alignment on compound kanji and inflected stems.
- Enhanced video transcript side panel with bounded virtualization and responsive audio controls.
- Full 8-language localization parity across 334 translation keys.
