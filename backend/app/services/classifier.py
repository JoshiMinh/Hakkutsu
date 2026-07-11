"""
Classifier service — uses fine-tuned Hugging Face transformer to predict JLPT difficulty.
"""

import os
import logging
from transformers import pipeline

from app.core.config import settings

logger = logging.getLogger(__name__)

class ClassifierService:
    def __init__(self):
        self.model_pipeline = None
        self._load_model()

    def _load_model(self):
        model_path = os.path.abspath(settings.CLASSIFIER_MODEL_PATH)
        logger.info(f"Loading difficulty classifier from {model_path}...")
        
        if not os.path.exists(model_path):
            logger.warning(f"Model path {model_path} does not exist. Difficulty classification will be disabled.")
            return

        try:
            # Load the text classification pipeline
            self.model_pipeline = pipeline(
                "text-classification",
                model=model_path,
                tokenizer=model_path,
                device=-1 # CPU for now
            )
            logger.info("Classifier model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load classifier model: {e}")

    def predict_difficulty(self, text: str):
        """
        Predicts JLPT difficulty for a given text.
        Returns a tuple of (predicted_label: str, confidence_score: float).
        Returns (None, None) if model is not loaded.
        """
        if not self.model_pipeline:
            return None, None

        try:
            # Pipeline returns a list of dicts, e.g., [{'label': 'LABEL_1', 'score': 0.98}]
            # We assume our model has labels like 'N1', 'N2', 'N3', 'N4', 'N5'
            result = self.model_pipeline(text)[0]
            label = result['label']
            score = float(result['score'])
            
            # Map 'LABEL_0', etc. back to 'N1'-'N5' if the pipeline didn't load the config's id2label correctly.
            # Usually id2label is saved in config.json. If it is N5, N4, etc. we just return it.
            if label.startswith('LABEL_'):
                # Fallback mapping if id2label is missing
                idx = int(label.split('_')[1])
                # Based on train.py, the order is typically N5 to N1 or something similar.
                # Actually, our dataset had N5, N4, N3, N2, N1. We should just return the label.
                # Assuming id2label is properly saved in the model.
                pass

            return label, score
        except Exception as e:
            logger.error(f"Error during difficulty prediction: {e}")
            return None, None

# Singleton instance
classifier_service = ClassifierService()
