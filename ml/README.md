# Hakkutsu ML Pipeline (Phase 2)

This directory will contain the complete ML workflow for the
Japanese Sentence Difficulty Classifier.

## Structure (Phase 2)

```
ml/
├── data/             # Training data (gitignored)
├── notebooks/        # Jupyter notebooks for exploration
├── src/
│   ├── dataset.py    # Dataset preparation & preprocessing
│   ├── model.py      # Model architecture definition
│   ├── train.py      # Training loop
│   ├── evaluate.py   # Evaluation metrics
│   └── inference.py  # Inference service
├── configs/          # Training configs
└── requirements.txt  # ML-specific dependencies
```

## Planned Workflow

1. **Dataset Preparation** — Collect JLPT-labeled sentences from textbooks and exams
2. **Preprocessing** — Tokenize with Sudachi, extract features, encode labels
3. **Fine-tuning** — Fine-tune a Japanese BERT model for 5-class classification
4. **Evaluation** — Accuracy, Precision, Recall, F1, Confusion Matrix
5. **Deployment** — Push to Hugging Face Hub, serve via FastAPI
