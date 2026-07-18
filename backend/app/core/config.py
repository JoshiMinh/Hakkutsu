"""
Application configuration loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
    ]

    # Firebase (optional — for token verification)
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS_PATH: str = ""

    # Data paths
    JMDICT_PATH: str = "app/data/jmdict/jmdict-eng.json"
    JLPT_DATA_PATH: str = "app/data/jlpt"
    FREQUENCY_DATA_PATH: str = "app/data/frequency"
    
    # ML Models
    CLASSIFIER_MODEL_PATH: str = "../ml/models/jlpt_classifier"

    # Sudachi
    SUDACHI_MODE: str = "C"  # A=short, B=medium, C=long unit

    # Manga OCR Studio
    OCR_LANGUAGES: list[str] = ["ja", "en"]
    OCR_GPU: str = "auto"
    OCR_RECOGNIZER: str = "manga_ocr"
    OCR_DETECTOR: str = "comic"
    OCR_DETECTION_THRESHOLD: float = 0.35
    BUBBLE_MODEL_ID: str = "huyvux3005/manga109-segmentation-bubble"
    BUBBLE_MODEL_FILE: str = "best.pt"
    BUBBLE_CONFIDENCE: float = 0.35
    BUBBLE_IMAGE_SIZE: int = 1600
    TRANSLATION_API_URL: str = "https://api.deepseek.com/chat/completions"
    TRANSLATION_API_KEY: str = ""
    TRANSLATION_MODEL: str = "deepseek-v4-flash"
    TRANSLATION_TIMEOUT: float = 120.0
    JAMDICT_DB_PATH: str = "app/data/models/jamdict/jamdict.db"
    MANGA_UPLOAD_DIR: str = "app/data/uploads"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
