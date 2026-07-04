# 🔍 Hakkutsu — AI-Powered Japanese Immersion Browser Extension

<div align="center">

**Learn Japanese while browsing the web, reading manga, and watching videos.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-green.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-teal.svg)](https://fastapi.tiangolo.com/)

</div>

---

## Overview

Hakkutsu (発掘, "excavation/discovery") is a Chrome browser extension that transforms any webpage into a Japanese learning environment. It detects Japanese text, provides instant analysis with tokenization, dictionary definitions, furigana, and JLPT levels, and lets you export vocabulary to Anki with one click.

### Key Features

- 🔤 **Japanese Text Detection** — Automatically identifies Japanese text on any webpage
- 📖 **Deep Analysis** — Tokenization, readings, POS tags, dictionary definitions, example sentences
- 🏷️ **JLPT Levels** — Instant N5–N1 classification for every word
- 📺 **YouTube Subtitles** — Extract and analyze Japanese subtitles from videos
- 🖼️ **OCR Support** — Extract Japanese text from images and manga panels
- 📇 **Anki Export** — One-click flashcard creation via AnkiConnect
- 🔐 **Cloud Sync** — Save vocabulary and settings with Firebase
- 🤖 **AI Difficulty Scoring** — Transformer-based sentence difficulty classification (Phase 2)

## Architecture

```
Hakkutsu/
├── extension/     # Chrome Extension (Plasmo + React + TypeScript)
├── backend/       # API Server (FastAPI + Python)
├── ml/            # ML Pipeline (PyTorch + Transformers) — Phase 2
└── shared/        # Shared type definitions
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- Python 3.11+
- Chrome browser

### Extension

```bash
cd extension
pnpm install
pnpm dev
```

Then load the extension in Chrome:
1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension/build/chrome-mv3-dev`

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -r requirements.txt
python -m app.main
```

The API will be available at `http://localhost:8000/docs`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension | Plasmo, React, TypeScript |
| Backend | FastAPI, Python, Sudachi |
| Database | Firebase Firestore |
| Auth | Firebase Authentication |
| NLP | SudachiPy, JMdict |
| OCR | MangaOCR / PaddleOCR |
| ML | PyTorch, Hugging Face Transformers |
| Flashcards | AnkiConnect |
| Hosting | Render |

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) by the Electronic Dictionary Research and Development Group
- [SudachiPy](https://github.com/WorksApplications/SudachiPy) by Works Applications
- [Plasmo](https://www.plasmo.com/) browser extension framework
- [AnkiConnect](https://github.com/FooSoft/anki-connect) by FooSoft Productions
