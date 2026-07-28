# Hakkutsu Project Roadmap

This document outlines the development roadmap, architectural split, code improvements, and feature additions for the Hakkutsu project. It also serves to map out the core AI goals aligned with the course requirements.

## 1. Core AI Goals (Project Requirements Match)
The core of this project relies heavily on the AI/ML pipeline to automate manga translation. These AI components are the foundation of your project and should be highlighted in your final report:
- **Text Detection & Segmentation:** Using AI (e.g., `comic-text-detector`) to accurately identify text bubbles and text regions in complex manga backgrounds.
- **Optical Character Recognition (OCR):** Using `Manga-OCR` or `EasyOCR` to accurately extract Japanese text from the detected regions, handling vertical text and handwritten fonts.
- **Inpainting (Text Removal):** Using AI models like `LaMa` (Large Mask Inpainting) to naturally fill in the background after the text is removed, restoring the art.
- **Contextual Translation:** Utilizing Large Language Models (LLMs like DeepSeek, OpenAI) to provide high-quality translations that understand the manga's context and nuances.

## 2. Backend / Extension (Frontend) Split

Currently, the project is split into two main components:

### The Backend (FastAPI, Python)
Handles all the heavy lifting and resource-intensive AI inference.
- **Features:** 
  - Image processing (OpenCV).
  - AI Inference (LaMa, Manga-OCR, Comic-text-detector).
  - Complex Typesetting.
  - Database management (SQLite/MLflow).
- **Why it's here:** These models require PyTorch, CUDA (GPU support), and significant memory, which cannot be run efficiently or safely in a browser environment.

### The Extension Frontend (Plasmo, React)
Acts as the user interface and content interceptor.
- **Features:**
  - Content scripts to intercept images from supported sites (like Netflix or Tonarinoyj).
  - Overlay UI for dictionary lookups, furigana generation (via `kuromoji`/`kuroshiro`), and editing translations.
  - Managing user interactions and displaying the processed images from the backend.

## 3. Migration Plan: Backend to Extension (Local vs. Server)

To reduce server load and make the application more responsive, some features can be moved directly to the browser extension (local execution).

### Features that CAN and SHOULD be moved to the Extension (Easy/Local):
1. **Dictionary & Morphological Analysis:** 
   - *Status:* Already partially implemented via `kuromoji` and `kuroshiro`.
   - *Action:* Completely handle tokenization and dictionary lookups in the browser to save backend API calls.
2. **Translation API Calls:** 
   - *Status:* Currently on the backend. 
   - *Action:* If the user provides their own API key (e.g., OpenAI, DeepSeek), the extension can make fetch calls directly to the LLM. This makes the backend purely an OCR/Image Processing server, drastically reducing your server hosting costs.
3. **Basic Typesetting & Rendering:** 
   - *Status:* Backend `typesetting_service.py` generates final images. 
   - *Action:* The backend should just return the translated text and the cleaned background image (inpainted). The extension's React UI can overlay the text dynamically via HTML/CSS on top of the image. This allows real-time font resizing and editing without re-requesting a new image from the backend!

### Features that MUST remain on the Backend (Heavy/Server):
1. **Inpainting (LaMa):** Requires PyTorch and GPU. Way too heavy for WebAssembly/Browser.
2. **Advanced OCR & Text Detection (Comic-Text-Detector):** While WebGL/WebGPU OCR exists, accuracy drops for complex manga fonts. Keep on the server for best results.
3. **ML Evaluation (MLFlow):** Centralized tracking of model metrics needs a backend database.

## 4. Code Improvements (Technical Debt)

- **Refactor `main.py`:** The `backend/main.py` is huge (131KB). Split it into smaller API routers (e.g., `routers/ocr.py`, `routers/translation.py`, `routers/manga.py`) to improve maintainability.
- **Dynamic Text Overlay rendering:** As mentioned above, stop burning text directly into the image on the backend. Send the raw text and bounding boxes to the frontend, and render the text using React components over the inpainted image. This gives users immediate editing capabilities.
- **Error Handling & Retries:** Implement robust retry logic in the extension for backend timeouts, especially when the backend is processing a heavy LaMa inpainting task.
- **Extension State Management:** Standardize state management in the Plasmo extension (consider Zustand or Jotai) for handling complex UI states across multiple manga panels.

## 5. Feature Additions (Future Roadmap)

- **Context-Aware Translation:** Pass the previous 3-4 translated dialogue boxes as context to the LLM to improve pronoun resolution and contextual accuracy in Japanese.
- **Anki/SRS Integration:** Allow users to click a word in the extension overlay and instantly generate an Anki flashcard (with the manga panel as the context image).
- **Webtoon / Vertical Scroll Support:** Expand support beyond traditional page-by-page manga to vertical scrolling manhwa/webtoons, requiring smart image slicing before sending to the OCR backend.
- **User Accounts & Cloud Sync:** Introduce Firebase auth in the extension to sync reading progress and custom vocabulary across devices.
