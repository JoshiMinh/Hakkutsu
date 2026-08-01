# Hakkutsu Project Agent Tasks

This document outlines the development roadmap, architectural split, code improvements, and feature additions for the Hakkutsu project, organized into three primary agent tasks.

## Task 1: Architecture Migration and Refactoring
**Goal:** Optimize system architecture by shifting lightweight processes to the frontend (Plasmo/React extension) and improving backend (FastAPI/Python) maintainability.

**Subtasks:**
- **Move Dictionary & Analysis:** Completely handle tokenization and dictionary lookups (via `kuromoji` and `kuroshiro`) in the browser to save backend API calls.
- **Client-Side LLM Calls:** Shift translation API calls to the extension, allowing users to provide their own API keys (OpenAI, DeepSeek) and reducing backend hosting costs.
- **Client-Side Typesetting:** Stop burning text directly into the image on the backend. Send raw text and bounding boxes to the frontend, and render the text dynamically using React components over the inpainted image.
- **Backend Refactoring:** Refactor the monolithic `backend/main.py` (131KB) by splitting it into smaller, maintainable API routers (e.g., `routers/ocr.py`, `routers/translation.py`, `routers/manga.py`).
- **State Management & Error Handling:** Standardize state management in the Plasmo extension (e.g., using Zustand or Jotai) and implement robust retry logic for backend timeouts (especially for heavy inpainting tasks).
- **Architecture Constraint:** Ensure heavy ML tasks—specifically LaMa Inpainting, advanced OCR (Comic-Text-Detector), and ML evaluation (MLFlow)—remain on the backend where GPU support is available.

## Task 2: Core AI Pipeline Integration and Enhancement
**Goal:** Maintain, evaluate, and improve the core AI/ML pipeline to automate and enhance manga translation accuracy.

**Subtasks:**
- **Text Detection & Segmentation:** Utilize and refine AI (e.g., `comic-text-detector`) to accurately identify text bubbles and text regions in complex manga backgrounds.
- **OCR Enhancements:** Implement `Manga-OCR` or `EasyOCR` to accurately extract Japanese text from the detected regions, ensuring strong handling of vertical text and handwritten fonts.
- **Inpainting Pipeline:** Seamlessly integrate `LaMa` (Large Mask Inpainting) to naturally fill in backgrounds after text removal, restoring the original art.
- **Centralized ML Tracking:** Maintain MLFlow integration on the backend to track model metrics and evaluate pipeline improvements continuously.

## Task 3: New Feature Development and UX Expansion
**Goal:** Develop new user-facing features to expand platform support, improve language learning, and enhance the overall reading experience.

**Subtasks:**
- **Anki/SRS Integration:** Build a feature allowing users to click a word in the extension overlay and instantly generate an Anki flashcard, including the manga panel as a context image.
- **Webtoon / Vertical Scroll Support:** Expand support beyond traditional page-by-page manga. Implement smart image slicing logic to handle vertical scrolling manhwa/webtoons before sending them to the OCR backend.