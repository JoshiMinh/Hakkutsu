# Hakkutsu - Final Presentation Slides Outline
**Course:** Specialized Project 2 (Đồ án chuyên ngành 2)
**Estimated Time:** 15-20 Minutes

---

## Slide 1: Title Slide
- **Project Title:** Hakkutsu - AI-Powered Japanese Learning & Text Difficulty Classification Extension
- **Student Name:** [Your Name]
- **Instructor:** [Instructor Name]
- **Date:** [Date]
- **Visuals:** Project Logo, clean minimalist Japanese aesthetic.

## Slide 2: Problem Statement
- **The Challenge:** Reading Japanese content online is difficult. 
  - Standard dictionary popups (like Yomichan/Yomitan) lack context.
  - Learners cannot easily gauge if an article is appropriate for their JLPT level.
  - Video content (YouTube) is hard to interact with seamlessly.
- **The Gap:** Existing tools don't leverage modern AI to assess the *overall difficulty* of a sentence.

## Slide 3: Project Goals (Hakkutsu)
- **1. AI/ML Integration:** Build a Machine Learning pipeline to classify Japanese sentences from N5 (Beginner) to N1 (Advanced).
- **2. Seamless UX:** Develop a Chrome Extension that analyzes text on any webpage without interrupting the user's flow.
- **3. Media Support:** Create an interactive, hoverable subtitle system for YouTube.
- **4. Progression Tracking:** Implement a Spaced Repetition System (SRS) to track learned vocabulary.

## Slide 4: System Architecture (High Level)
- **Diagram:** Show the 3-tier architecture.
  - **Client (Extension):** Plasmo (React, TypeScript), Content Scripts, DOM Mutation Observers.
  - **Backend (API):** FastAPI, Python, Firebase Auth middleware.
  - **AI & NLP Engine:** Hugging Face Transformers (BERT), Sudachi Tokenizer, JMdict.
- **Key Takeaway:** Modular design allowing for future scalability and cross-browser support.

## Slide 5: AI/ML Pipeline - Data Collection & Preprocessing
- **Data Source:** JLPT labeled sentences (Tatoeba corpus, etc.).
- **Preprocessing Steps:**
  1. Unicode normalization (NFKC).
  2. Tokenization using SudachiPy.
  3. Filtering outliers (too long/short sentences).
- **Visuals:** A quick EDA chart showing the distribution of sentences across N5-N1.

## Slide 6: AI/ML Pipeline - Model Training
- **The Model:** Fine-tuned `cl-tohoku/bert-base-japanese` (Transformer architecture).
- **Why BERT?:** Deep bidirectional context understanding is crucial for Japanese grammar.
- **Training Setup:** PyTorch, Cross-Entropy Loss, AdamW Optimizer.
- **Visuals:** A simple diagram showing text going into BERT and outputting probabilities for 5 classes (N5-N1).

## Slide 7: AI/ML Pipeline - Evaluation & Results
- **Metrics:** Accuracy, Precision, Recall, F1-Score.
- **Confusion Matrix:** Highlight where the model performs best and where it struggles (e.g., distinguishing between N3 and N2).
- **Conclusion on Model:** The model successfully predicts sentence difficulty with [X]% accuracy, making it viable for real-world usage.

## Slide 8: Chrome Extension - Core Features
- **Real-time DOM Scanning:** Instantly detects Japanese text.
- **The Popup & Hover UI:** Displays Furigana, English meanings (via JMdict), and the **AI Difficulty Score**.
- **Performance:** Lightweight React components injected via Shadow DOM to prevent CSS conflicts with host websites.

## Slide 9: Interactive YouTube Subtitles
- **Feature Overview:** Turns static YouTube captions into interactive learning materials.
- **How it works:** 
  - Intercepts YouTube's transcript API.
  - Syncs with `video.currentTime`.
  - Pauses video automatically on hover for reading.
- **Visuals:** Screenshot or short GIF of the YouTube feature in action.

## Slide 10: Spaced Repetition (SRS) & Progression
- **Vocabulary Tracking:** Users can save words to their personal deck.
- **Heatmap Generation:** Pages are color-coded based on the user's known vocabulary.
- **Integration:** Syncs with Firebase (Cloud) and AnkiConnect (Local).

## Slide 11: Live Demo / Video Walkthrough
- *(Optional but highly recommended)*
- **Demo Script:**
  1. Open a Japanese news site (e.g., NHK News Web Easy).
  2. Highlight a sentence to show the AI difficulty classification.
  3. Open a YouTube video, toggle Hakkutsu subtitles, and hover over a word.
  4. Save a word to the SRS deck.

## Slide 12: Challenges & Solutions
- **Challenge 1:** Transformer models are heavy and slow for real-time web usage.
  - *Solution:* Offloaded inference to a dedicated FastAPI backend instead of running on-device, heavily caching dictionary lookups.
- **Challenge 2:** Extension UI breaking on different websites.
  - *Solution:* Used Plasmo's Shadow DOM capabilities to isolate CSS styles.

## Slide 13: Future Work
- **OCR Integration:** Use MangaOCR to analyze text inside images and manga panels.
- **Model Quantization:** Convert the BERT model to ONNX to run directly in the browser via WebAssembly, reducing server costs.
- **Grammar Explanations:** Integrate an LLM (like Gemini) to provide deep grammar explanations.

## Slide 14: Q&A
- **Thank you!**
- Questions?
- **Contact/GitHub Link:** [Link to repository]
