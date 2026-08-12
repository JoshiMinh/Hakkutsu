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
STUDY_ASSET_DIR = DATA_DIR / "study"
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024
LAMA_MODEL_PATH = Path(
    os.getenv("LAMA_MODEL_PATH", str(MODEL_DIR / "lama" / "big-lama.pt"))
)
LAMA_ENABLED = os.getenv("LAMA_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
CTD_ENABLED = os.getenv("CTD_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
CTD_VENDOR_PATH = Path(
    os.getenv("CTD_VENDOR_PATH", str(DATA_DIR / "vendor" / "comic-text-detector"))
)
CTD_MODEL_PATH = Path(
    os.getenv(
        "CTD_MODEL_PATH",
        str(MODEL_DIR / "comic-text-detector" / "comictextdetector.pt"),
    )
)
CTD_DEVICE = os.getenv("CTD_DEVICE", "auto").strip().lower()
CTD_INPUT_SIZE = int(os.getenv("CTD_INPUT_SIZE", "1024"))
CTD_MULTI_SCALES = tuple(
    int(value.strip())
    for value in os.getenv("CTD_MULTI_SCALES", "1024,704,576").split(",")
    if value.strip()
)
JAMDICT_DB_PATH = MODEL_DIR / "jamdict" / "jamdict.db"
OCR_LANGUAGES = [item.strip() for item in os.getenv("OCR_LANGUAGES", "ja,en").split(",") if item.strip()]
OCR_GPU = os.getenv("OCR_GPU", "cpu").strip().lower()
OCR_RECOGNIZER = os.getenv("OCR_RECOGNIZER", "manga_ocr").strip().lower()
OCR_DETECTOR = os.getenv("OCR_DETECTOR", "comic").strip().lower()
OCR_DETECTION_THRESHOLD = float(os.getenv("OCR_DETECTION_THRESHOLD", "0.35"))
OCR_FALLBACK_THRESHOLD = float(os.getenv("OCR_FALLBACK_THRESHOLD", "0.15"))
OCR_FALLBACK_TILE_SIZE = int(os.getenv("OCR_FALLBACK_TILE_SIZE", "640"))
OCR_FALLBACK_TILE_OVERLAP = int(os.getenv("OCR_FALLBACK_TILE_OVERLAP", "128"))
BUBBLE_MODEL_ID = os.getenv(
    "BUBBLE_MODEL_ID", "huyvux3005/manga109-segmentation-bubble"
).strip()
BUBBLE_MODEL_FILE = os.getenv("BUBBLE_MODEL_FILE", "best.pt").strip()
BUBBLE_CONFIDENCE = float(os.getenv("BUBBLE_CONFIDENCE", "0.35"))
BUBBLE_IMAGE_SIZE = int(os.getenv("BUBBLE_IMAGE_SIZE", "1600"))
BUBBLE_DEVICE = os.getenv("BUBBLE_DEVICE", "cpu").strip().lower()
TRANSLATION_API_URL = os.getenv(
    "TRANSLATION_API_URL", "https://api.deepseek.com/chat/completions"
).strip()
TRANSLATION_API_KEY = os.getenv(
    "TRANSLATION_API_KEY", os.getenv("DEEPSEEK_API_KEY", "")
).strip()
TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "deepseek-v4-flash").strip()
TRANSLATION_TIMEOUT = float(os.getenv("TRANSLATION_TIMEOUT", "120"))
JAVI_ANALYSIS_ENABLED = os.getenv(
    "JAVI_ANALYSIS_ENABLED", "false"
).strip().lower() in {"1", "true", "yes", "on"}
JAVI_ANALYSIS_API_URL = os.getenv(
    "JAVI_ANALYSIS_API_URL", "http://127.0.0.1:11434/v1/chat/completions"
).strip()
JAVI_ANALYSIS_API_KEY = os.getenv("JAVI_ANALYSIS_API_KEY", "").strip()
JAVI_ANALYSIS_MODEL = os.getenv(
    "JAVI_ANALYSIS_MODEL", "hakkutsu-javi:latest"
).strip()
JAVI_ANALYSIS_TIMEOUT = float(os.getenv("JAVI_ANALYSIS_TIMEOUT", "45"))
VISUAL_SUPERVISOR_ENABLED = os.getenv("VISUAL_SUPERVISOR_ENABLED", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
VISUAL_SUPERVISOR_API_URL = os.getenv(
    "VISUAL_SUPERVISOR_API_URL", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
).strip()
VISUAL_SUPERVISOR_API_KEY = os.getenv("VISUAL_SUPERVISOR_API_KEY", os.getenv("GEMINI_API_KEY", "")).strip()
VISUAL_SUPERVISOR_MODEL = os.getenv("VISUAL_SUPERVISOR_MODEL", "gemini-2.5-flash").strip()
VISUAL_SUPERVISOR_TIMEOUT = float(os.getenv("VISUAL_SUPERVISOR_TIMEOUT", "180"))
VISUAL_SUPERVISOR_MAX_EDGE = int(os.getenv("VISUAL_SUPERVISOR_MAX_EDGE", "1600"))
VISUAL_SUPERVISOR_MIN_CONFIDENCE = float(
    os.getenv("VISUAL_SUPERVISOR_MIN_CONFIDENCE", "0.62")
)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
# Auto-detect if TRANSLATION_API_KEY looks like a Google Gemini API Key (starts with AIzaSy)
if not GEMINI_API_KEY and TRANSLATION_API_KEY.startswith("AIzaSy"):
    GEMINI_API_KEY = TRANSLATION_API_KEY

GEMINI_API_URL = os.getenv(
    "GEMINI_API_URL",
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
).strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "45"))


def is_gemini_configured() -> bool:
    return bool(GEMINI_API_KEY)
SHOW_MODE_SWITCH = os.getenv("SHOW_MODE_SWITCH", "true").strip().lower() in {"1", "true", "yes", "on"}
JLPT_CLASSIFIER_PATH = Path(
    os.getenv("JLPT_CLASSIFIER_PATH", str(BASE_DIR / "ml" / "models" / "jlpt_classifier"))
)
JLPT_CLASSIFIER_ENABLED = os.getenv("JLPT_CLASSIFIER_ENABLED", "true").strip().lower() in {
    "1", "true", "yes", "on"
}


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    LAMA_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    CTD_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    CTD_VENDOR_PATH.parent.mkdir(parents=True, exist_ok=True)
