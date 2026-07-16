from datetime import datetime, timedelta
from typing import List, Optional
from app.models.srs import SrsCard, ReviewSubmit, SrsState, ReviewQuality
from app.core.firebase import get_db
import firebase_admin.firestore as firestore
import logging

logger = logging.getLogger(__name__)

# Collection names
SRS_CARDS_COLLECTION = "srs_cards"
MINED_SENTENCES_COLLECTION = "mined_sentences"

def calculate_sm2(card: SrsCard, quality: int) -> SrsCard:
    """
    SuperMemo-2 (SM-2) algorithm.
    quality: 0-5
      0: Complete failure to recall
      1: Incorrect, but remembered the correct answer upon seeing it
      2: Correct, but required a lot of thought
      3: Correct, recalled with some effort
      4: Correct, recalled perfectly
      5: Correct, recalled instantly and effortlessly
    """
    if quality < 3:
        # Incorrect response
        card.repetition = 0
        card.interval = 1.0
        card.state = SrsState.LEARNING
    else:
        # Correct response
        if card.repetition == 0:
            card.interval = 1.0
        elif card.repetition == 1:
            card.interval = 6.0
        else:
            card.interval = round(card.interval * card.easiness)
        
        card.repetition += 1
        card.state = SrsState.REVIEW
        # If interval gets large enough, mark as graduated (e.g., > 21 days)
        if card.interval > 21:
            card.state = SrsState.GRADUATED

    # Update easiness factor
    card.easiness = card.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if card.easiness < 1.3:
        card.easiness = 1.3

    # Update dates
    card.last_review = datetime.utcnow()
    card.next_review = datetime.utcnow() + timedelta(days=card.interval)
    card.updated_at = datetime.utcnow()
    
    return card

class SrsService:
    @staticmethod
    def get_due_cards(user_id: str, limit: int = 50) -> List[SrsCard]:
        db = get_db()
        if not db:
            return []
        
        now = datetime.utcnow()
        # Query Firestore for cards where user_id == user_id and next_review <= now
        cards_ref = db.collection(SRS_CARDS_COLLECTION)
        query = cards_ref.where("user_id", "==", user_id).where("next_review", "<=", now).limit(limit)
        
        try:
            results = query.stream()
            cards = []
            for doc in results:
                data = doc.to_dict()
                data["id"] = doc.id
                # Fix timestamp conversion from Firestore
                if "next_review" in data and hasattr(data["next_review"], "timestamp"):
                     data["next_review"] = datetime.fromtimestamp(data["next_review"].timestamp())
                if "last_review" in data and data["last_review"] and hasattr(data["last_review"], "timestamp"):
                     data["last_review"] = datetime.fromtimestamp(data["last_review"].timestamp())
                if "created_at" in data and hasattr(data["created_at"], "timestamp"):
                     data["created_at"] = datetime.fromtimestamp(data["created_at"].timestamp())
                if "updated_at" in data and hasattr(data["updated_at"], "timestamp"):
                     data["updated_at"] = datetime.fromtimestamp(data["updated_at"].timestamp())
                cards.append(SrsCard(**data))
            return cards
        except Exception as e:
            logger.error(f"Error fetching due cards: {e}")
            return []

    @staticmethod
    def submit_review(user_id: str, submit: ReviewSubmit) -> Optional[SrsCard]:
        db = get_db()
        if not db:
            return None
        
        doc_ref = db.collection(SRS_CARDS_COLLECTION).document(submit.card_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        
        data = doc.to_dict()
        data["id"] = doc.id
        # Parse dates
        for field in ["next_review", "last_review", "created_at", "updated_at"]:
            if field in data and data[field] and hasattr(data[field], "timestamp"):
                data[field] = datetime.fromtimestamp(data[field].timestamp())
        
        card = SrsCard(**data)
        if card.user_id != user_id:
            return None # Unauthorized
            
        # Apply SM-2
        card = calculate_sm2(card, submit.quality.value)
        
        # Save back to Firestore
        save_data = card.dict(exclude={"id"})
        doc_ref.set(save_data)
        
        return card

    @staticmethod
    def get_user_vocab_states(user_id: str, words: List[str]) -> dict:
        """Fetch the state of specific words for a user (used for heatmap)"""
        db = get_db()
        if not db or not words:
            return {}
            
        cards_ref = db.collection(SRS_CARDS_COLLECTION)
        
        # Firestore 'in' query supports max 10 items.
        # We need to chunk the words.
        chunk_size = 10
        chunks = [words[i:i + chunk_size] for i in range(0, len(words), chunk_size)]
        
        states = {}
        try:
            for chunk in chunks:
                query = cards_ref.where("user_id", "==", user_id).where("word", "in", chunk)
                for doc in query.stream():
                    data = doc.to_dict()
                    states[data.get("word")] = data.get("state", "new")
        except Exception as e:
            logger.error(f"Error fetching vocab states: {e}")
            
        return states

    @staticmethod
    def get_stats(user_id: str) -> dict:
        """Get aggregate stats of user's SRS progress."""
        db = get_db()
        if not db:
            return {}
            
        cards_ref = db.collection(SRS_CARDS_COLLECTION)
        query = cards_ref.where("user_id", "==", user_id)
        
        stats = {
            "total": 0,
            "new": 0,
            "learning": 0,
            "review": 0,
            "graduated": 0
        }
        
        try:
            # Note: For large datasets, fetching all docs is slow, but Firebase requires a paid plan to use aggregation queries like count() with filters on client SDK. 
            # In Admin SDK, count() is available. We'll use get() for now.
            docs = query.stream()
            for doc in docs:
                data = doc.to_dict()
                state = data.get("state", "new")
                if state in stats:
                    stats[state] += 1
                stats["total"] += 1
                
            # Get mined sentences count
            mined_ref = db.collection(MINED_SENTENCES_COLLECTION)
            mined_query = mined_ref.where("user_id", "==", user_id)
            stats["mined"] = sum(1 for _ in mined_query.stream())
            
        except Exception as e:
            logger.error(f"Error calculating stats: {e}")
            
        return stats

    @staticmethod
    def get_all_cards(user_id: str) -> List[SrsCard]:
        """Fetch all SRS cards for a user."""
        db = get_db()
        if not db:
            return []
            
        cards_ref = db.collection(SRS_CARDS_COLLECTION)
        query = cards_ref.where("user_id", "==", user_id).order_by("created_at", direction=firestore.Query.DESCENDING)
        
        try:
            results = query.stream()
            cards = []
            for doc in results:
                data = doc.to_dict()
                data["id"] = doc.id
                # Fix timestamp conversion from Firestore
                for field in ["next_review", "last_review", "created_at", "updated_at"]:
                    if field in data and data[field] and hasattr(data[field], "timestamp"):
                        data[field] = datetime.fromtimestamp(data[field].timestamp())
                cards.append(SrsCard(**data))
            return cards
        except Exception as e:
            logger.error(f"Error fetching all cards: {e}")
            return []

    @staticmethod
    def add_card(user_id: str, word: str, reading: Optional[str] = None, meaning: Optional[str] = None, sentence: Optional[str] = None) -> Optional[SrsCard]:
        db = get_db()
        if not db:
            return None
            
        cards_ref = db.collection(SRS_CARDS_COLLECTION)
        
        # Check if already exists
        query = cards_ref.where("user_id", "==", user_id).where("word", "==", word).limit(1)
        existing = list(query.stream())
        if existing:
            doc = existing[0]
            data = doc.to_dict()
            data["id"] = doc.id
            # Need to parse dates here in real code, but for now we just return it
            return SrsCard(**data)
            
        new_card = SrsCard(
            user_id=user_id,
            word=word,
            reading=reading,
            meaning=meaning,
            sentence=sentence
        )
        save_data = new_card.dict(exclude={"id"})
        doc_ref = cards_ref.document()
        doc_ref.set(save_data)
        
        new_card.id = doc_ref.id
        return new_card

    @staticmethod
    def add_mined_sentence(user_id: str, sentence: str, source_url: Optional[str] = None, source_title: Optional[str] = None, target_word: Optional[str] = None) -> Optional[str]:
        from app.models.srs import MinedSentence
        db = get_db()
        if not db:
            return None
            
        ms = MinedSentence(
            user_id=user_id,
            sentence=sentence,
            source_url=source_url,
            source_title=source_title,
            target_word=target_word
        )
        doc_ref = db.collection(MINED_SENTENCES_COLLECTION).document()
        doc_ref.set(ms.dict(exclude={"id"}))
        return doc_ref.id
