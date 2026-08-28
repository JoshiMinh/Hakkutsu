# Hakkutsu (発掘) — Extension Package

Hakkutsu is an AI-powered browser extension for Japanese language immersion, inline dictionary lookups, local OCR screenshot text extraction, and Anki flashcard mining.

## Features

- **Offline Local OCR**: Press `Ctrl + Shift + X` to crop any image or text on the screen for offline Tesseract Japanese OCR (`jpn` & `jpn_vert`) running in a Chrome MV3 Offscreen Worker.
- **Inline Dictionary**: Highlight, double-click, or `Alt + Hover` Japanese text on any webpage to see instant readings, Hán-Việt pronunciations, JLPT levels, and definitions.
- **AI Analysis**: Deep sentence translation and grammar breakdown powered by Gemini or OpenAI API keys.
- **Anki & SRS**: 1-click sync to Anki via AnkiConnect or review using the built-in Spaced Repetition System.

## Development Scripts

```bash
# Install dependencies
pnpm install

# Run Plasmo development server
pnpm dev

# Type check
pnpm typecheck

# Package production ZIP bundle
pnpm package
```
