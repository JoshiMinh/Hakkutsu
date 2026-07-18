import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file() -> None:
    """Load project settings for every entrypoint, not only run.ps1."""
    env_path = BASE_DIR / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name:
            os.environ.setdefault(name, value.strip().strip('"').strip("'"))


_load_env_file()
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "manga_translator.db"
STATIC_DIR = BASE_DIR / "static"
MODEL_DIR = DATA_DIR / "models"
JAMDICT_DB_PATH = MODEL_DIR / "jamdict" / "jamdict.db"
OCR_LANGUAGES = [item.strip() for item in os.getenv("OCR_LANGUAGES", "ja,en").split(",") if item.strip()]
OCR_GPU = os.getenv("OCR_GPU", "auto").strip().lower()
OCR_RECOGNIZER = os.getenv("OCR_RECOGNIZER", "manga_ocr").strip().lower()
OCR_DETECTOR = os.getenv("OCR_DETECTOR", "comic").strip().lower()
OCR_DETECTION_THRESHOLD = float(os.getenv("OCR_DETECTION_THRESHOLD", "0.35"))
BUBBLE_MODEL_ID = os.getenv(
    "BUBBLE_MODEL_ID", "huyvux3005/manga109-segmentation-bubble"
).strip()
BUBBLE_MODEL_FILE = os.getenv("BUBBLE_MODEL_FILE", "best.pt").strip()
BUBBLE_CONFIDENCE = float(os.getenv("BUBBLE_CONFIDENCE", "0.35"))
BUBBLE_IMAGE_SIZE = int(os.getenv("BUBBLE_IMAGE_SIZE", "1600"))
TRANSLATION_API_URL = os.getenv(
    "TRANSLATION_API_URL", "https://api.deepseek.com/chat/completions"
).strip()
TRANSLATION_API_KEY = os.getenv(
    "TRANSLATION_API_KEY", os.getenv("DEEPSEEK_API_KEY", "")
).strip()
TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "deepseek-v4-flash").strip()
TRANSLATION_TIMEOUT = float(os.getenv("TRANSLATION_TIMEOUT", "120"))
SHOW_MODE_SWITCH = os.getenv("SHOW_MODE_SWITCH", "true").strip().lower() in {"1", "true", "yes", "on"}


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
