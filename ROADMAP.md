# Hakkutsu Development Roadmap

This document outlines an 8-stage roadmap for completing the AI Difficulty Classifier and expanding the extension's features. 

Each stage includes an **Agent Prompt** that you can copy and paste to an AI coding assistant to automatically implement that stage.

---

## [x] Stage 0: MVP (Completed)
- Chrome extension with Plasmo + React + TypeScript
- Japanese text detection and analysis popup (Sudachi, JMdict, JLPT, Furigana)
- YouTube subtitle extraction
- AnkiConnect & Firebase sync

---

## [x] Stage 1: Core ML Data Pipeline (Completed)
**Focus:** Data Organization & Analysis (Tổ chức và phân tích dữ liệu)

**Overview:** 
The first step of the AI Difficulty Classifier is gathering and cleaning data. We need to collect JLPT-labeled sentences and preprocess them for Transformer model fine-tuning.

**Agent Prompt:**
> "Execute Stage 1 of the ROADMAP.md: Set up the Python data pipeline in the `ml/` directory. Create a script to download and parse JLPT-labeled sentences (e.g., from Tatoeba). Implement a data cleaning and preprocessing pipeline. Finally, perform Exploratory Data Analysis (EDA) on sentence complexity and save the processed dataset as CSV/JSON for model training."

---

## [ ] Stage 2: Model Training & Evaluation
**Focus:** Model Selection, Building, and Evaluation (Lựa chọn, xây dựng và đánh giá mô hình)

**Overview:** 
Train a Transformer model (like BERT or RoBERTa) on the processed dataset to classify Japanese sentences from N5 to N1 difficulty. Evaluate the model's accuracy.

**Agent Prompt:**
> "Execute Stage 2 of the ROADMAP.md: In the `ml/` directory, write a PyTorch/Hugging Face script to fine-tune a pre-trained Transformer model (e.g., `cl-tohoku/bert-base-japanese`) on our JLPT dataset. Implement an evaluation suite to calculate Accuracy, Precision, Recall, and F1-score, and generate a Confusion Matrix. Add MLflow or Weights & Biases for experiment tracking."

---

## [ ] Stage 3: AI Application Integration
**Focus:** Application Integration (Áp dụng xây dựng ứng dụng)

**Overview:** 
The trained model needs to be exposed as an API and consumed by the Chrome extension to display difficulty scores to the user.

**Agent Prompt:**
> "Execute Stage 3 of the ROADMAP.md: Create a FastAPI inference endpoint in the `backend/` to serve the trained difficulty classifier model. Then, update the `extension/` to call this new endpoint. Modify the UI to prominently display AI confidence scores and JLPT difficulty ratings when a user analyzes a sentence on a webpage."

---

## [ ] Stage 4: Academic Deliverables
**Focus:** Course Requirements (Đồ án chuyên ngành 2)

**Overview:** 
Prepare the necessary academic documentation and presentations required to successfully defend the project.

**Agent Prompt:**
> "Execute Stage 4 of the ROADMAP.md: Help me outline and draft the final report (Báo cáo tổng kết) ensuring it has at least 20 pages of content covering the AI/ML pipeline and application. Then, draft the structure for the English presentation slides. Finally, create a script to package the source code and dataset for the final university submission."

---

## [ ] Stage 5: OCR & Media Integration
**Focus:** Computer Vision & Multi-platform Support

**Overview:** 
Extend the extension's capabilities beyond simple text and YouTube. Add support for images, manga, and other streaming platforms.

**Agent Prompt:**
> "Execute Stage 5 of the ROADMAP.md: Integrate MangaOCR or PaddleOCR to allow users to extract text directly from images and manga panels via a screenshot tool. Update the extension architecture to support Netflix subtitles, reusing the existing YouTube extraction logic."

---

## [ ] Stage 6: Linguistic Deep Dive
**Focus:** Advanced Japanese Analysis

**Overview:** 
Provide deeper explanations of Japanese text, going beyond basic dictionary definitions to include grammar, stroke order, and kanji components.

**Agent Prompt:**
> "Execute Stage 6 of the ROADMAP.md: Integrate an API or local data source to display Kanji stroke order animations and radical breakdowns. Next, implement a grammar pattern recognition module to identify common Japanese grammar structures in the analyzed text and provide detailed explanations for them."

---

## [ ] Stage 7: Advanced Learning & SRS Features
**Focus:** User Progression & Spaced Repetition

**Overview:** 
Help users track their learning journey and retain vocabulary without relying strictly on third-party tools like Anki.

**Agent Prompt:**
> "Execute Stage 7 of the ROADMAP.md: Build a native Spaced Repetition System (SRS) algorithm directly into the extension and backend. Implement a 'Reading difficulty heatmap' that colors webpages based on the user's known vocabulary. Add a sentence mining mode to auto-collect sentences containing target words."

---

## [ ] Stage 8: Polish, Publishing & CI/CD
**Focus:** Production Readiness & Community

**Overview:** 
Prepare the app for public release on the Chrome Web Store and ensure code quality and performance.

**Agent Prompt:**
> "Execute Stage 8 of the ROADMAP.md: Implement comprehensive performance optimizations (lazy loading, caching). Set up a CI/CD pipeline using GitHub Actions for automated testing and builds. Finally, prepare the required assets and manifest updates for publishing the extension to the Chrome Web Store and porting it to Firefox."
