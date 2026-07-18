from typing import Optional, Dict
from datetime import datetime, timezone
from app.core.firebase import get_db

CACHE_COLLECTION = "study_analysis_cache"

def get_cached_analysis(text_hash: str) -> Optional[Dict]:
    db = get_db()
    doc_ref = db.collection(CACHE_COLLECTION).document(text_hash)
    doc = doc_ref.get()
    if doc.exists:
        data = doc.to_dict()
        return data.get("analysis_json")
    return None

def save_cached_analysis(text_hash: str, source_text: str, analysis_json: Dict) -> None:
    db = get_db()
    doc_ref = db.collection(CACHE_COLLECTION).document(text_hash)
    now = datetime.now(timezone.utc)
    
    # We use set with merge=True to act as an UPSERT
    doc_ref.set({
        "text_hash": text_hash,
        "source_text": source_text,
        "analysis_json": analysis_json,
        "updated_at": now
    }, merge=True)
