# Hakkutsu Roadmap

## ✅ Phase 1 — MVP (Current)
- [x] Chrome extension with Plasmo + React + TypeScript
- [x] Japanese text detection on webpages
- [x] Text selection → analysis popup
- [x] FastAPI backend with Sudachi tokenization
- [x] JMdict dictionary lookups
- [x] JLPT level tagging (N5–N1)
- [x] Word frequency ranking
- [x] Furigana display
- [x] YouTube subtitle extraction
- [x] AnkiConnect integration (one-click export)
- [x] Firebase Authentication (Google sign-in)
- [x] Firebase Firestore (vocabulary sync)
- [x] Dark mode UI with Japanese aesthetic

## 🔄 Phase 2 — AI Difficulty Classifier
- [ ] Dataset preparation (JLPT-labeled sentences)
- [ ] Data preprocessing pipeline
- [ ] Fine-tune Transformer model (BERT-based) for N5–N1 classification
- [ ] Evaluation suite (Accuracy, Precision, Recall, F1, Confusion Matrix)
- [ ] Deploy model to Hugging Face Hub
- [ ] FastAPI inference endpoint
- [ ] Display confidence scores in extension UI
- [ ] ML experiment tracking and documentation

## 🔮 Phase 3 — Enhanced Features
- [ ] Netflix subtitle support (architecture already designed for multi-platform)
- [ ] MangaOCR integration for image text extraction
- [ ] PaddleOCR fallback for complex layouts
- [ ] Screenshot capture for Anki cards
- [ ] Kanji stroke order animations
- [ ] Radical breakdown display
- [ ] Grammar pattern recognition and explanations

## 🚀 Phase 4 — Advanced Learning
- [ ] Spaced repetition algorithm (built-in, alongside Anki)
- [ ] Reading difficulty heatmap for webpages
- [ ] Personal vocabulary statistics and progress tracking
- [ ] Sentence mining mode (auto-collect sentences with target words)
- [ ] Pitch accent information display
- [ ] Conjugation table display
- [ ] Collocations and common word pairs

## 🌐 Phase 5 — Community & Polish
- [ ] User accounts with learning streaks
- [ ] Shared vocabulary lists
- [ ] Browser reading mode (simplified Japanese pages)
- [ ] Multi-language interface (EN/JP/VN)
- [ ] Chrome Web Store publication
- [ ] Firefox extension port
- [ ] Performance optimization (lazy loading, caching)
- [ ] Comprehensive test suite (unit, integration, e2e)
- [ ] CI/CD pipeline with GitHub Actions

## 💡 Ideas Under Consideration
- LLM-powered grammar explanations (optional, not core AI)
- Voice synthesis for pronunciation
- Handwriting recognition input
- Integration with other SRS systems (Memrise, WaniKani)
- Companion mobile app
- Real-time translation overlay (toggle)
