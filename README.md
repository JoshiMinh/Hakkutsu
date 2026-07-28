# Hakkutsu (Manga Translator Studio)

**Hakkutsu** is an AI-powered Japanese immersion and manga translation tool. It automates the entire process of translating manga and web reading: from image crawling, text detection, and OCR, to text removal (inpainting), contextual AI translation, and typesetting.

---

## 🧠 Core AI Features & Models

This project heavily utilizes Artificial Intelligence, bridging both Computer Vision and Natural Language Processing (NLP) to create a seamless translation experience.

### 1. Computer Vision (Image Processing)
*   **Text Detection (Segmentation):** Uses **`comic-text-detector`** (a deep learning model) to identify complex text bubbles and sound effects (SFX) against noisy manga backgrounds.
*   **Optical Character Recognition (OCR):** Employs **`Manga-OCR`** (a specialized vision model for Japanese manga) and **`EasyOCR`** to accurately extract text, including vertical and handwritten fonts.
*   **Image Inpainting (Text Removal):** Uses **`LaMa`** (Large Mask Inpainting), an advanced AI neural network, to seamlessly restore the background artwork after the original Japanese text is removed.

### 2. Natural Language Processing (NLP & LLMs)
*   **Morphological Analysis:** Uses **`SudachiPy`** and **`Kuromoji`** to break down Japanese sentences into tokens (words) and identify their grammatical roles.
*   **Contextual Translation & Study Analysis (LLMs):** 
    *   Integrates with Generative AI via APIs (e.g., **OpenAI**, **DeepSeek**, or a fine-tuned local **Hakkutsu Ja-Vi model**) to translate text. 
    *   The AI goes beyond translation to act as a "Japanese Teacher"—analyzing the sentence context to provide accurate grammatical explanations and token-by-token meanings for learners.

---

## ⚙️ Configuration & APIs

You can configure the AI models and APIs in the `.env` file at the root of the project:

```env
# OCR Configuration
OCR_LANGUAGES=ja,en
OCR_GPU=auto
OCR_RECOGNIZER=manga_ocr
OCR_DETECTOR=comic

# Translation & NLP API Configuration
# Uses OpenAI-compatible API endpoints for translation and grammar analysis.
TRANSLATION_API_URL=https://api.deepseek.com/chat/completions
TRANSLATION_MODEL=deepseek-v4-flash
TRANSLATION_API_KEY=your_api_key_here
```
*(Note: Do not commit your `.env` file!)*

---

## 🚀 Quick Start (Development)

The project consists of a FastAPI backend (handling heavy AI inference) and a Plasmo React extension (for the user interface).

### 1. Run the Backend (AI Inference Server)
The backend requires Python and handles the LaMa, OCR, and DB operations.
```powershell
# In the project root
.\run.ps1
```
*(This automatically creates `.venv`, installs requirements, and starts the server at `http://127.0.0.1:8000`)*

### 2. Run the Frontend (Plasmo Extension)
The extension intercepts images and provides the translation overlay UI.
```powershell
# In the project root
pnpm i
pnpm run dev
```
**To install in Chrome/Edge:**
1. Open `chrome://extensions/`
2. Enable **Developer Mode**.
3. Click **Load unpacked** and select `extension/build/chrome-mv3-dev`.

---

## 📦 Project Architecture Overview
*   **Backend (`backend/`):** FastAPI, SQLite, PyTorch (LaMa, Manga-OCR), OpenCV.
*   **Frontend (`extension/`):** React, TypeScript, Plasmo, Kuroshiro.
*   **Machine Learning (`ml/`):** MLflow tracking, custom model training, and ML pipeline scripts.
