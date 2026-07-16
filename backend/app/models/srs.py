from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class SrsState(str, Enum):
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    GRADUATED = "graduated"

class SrsCardBase(BaseModel):
    user_id: str
    word: str # the dictionary form of the word
    reading: Optional[str] = None
    meaning: Optional[str] = None
    sentence: Optional[str] = None # Example sentence
    
class SrsCardCreate(SrsCardBase):
    pass

class SrsCard(SrsCardBase):
    id: Optional[str] = None
    state: SrsState = SrsState.NEW
    repetition: int = 0
    interval: float = 0.0 # days
    easiness: float = 2.5
    next_review: datetime = Field(default_factory=datetime.utcnow)
    last_review: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ReviewQuality(int, Enum):
    BLACKOUT = 0       # Complete failure to recall
    INCORRECT = 1      # Incorrect, but remembered the correct answer upon seeing it
    DIFFICULT = 2      # Correct, but required a lot of thought
    GOOD = 3           # Correct, recalled with some effort
    EASY = 4           # Correct, recalled perfectly
    PERFECT = 5        # Correct, recalled instantly and effortlessly

class ReviewSubmit(BaseModel):
    card_id: str
    quality: ReviewQuality

class MinedSentenceBase(BaseModel):
    user_id: str
    sentence: str
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    target_word: Optional[str] = None

class MinedSentenceCreate(MinedSentenceBase):
    pass

class MinedSentence(MinedSentenceBase):
    id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class HeatmapRequest(BaseModel):
    user_id: str
    tokens: List[str] # List of dictionary forms to check

class HeatmapResponse(BaseModel):
    # Mapping of dictionary form to its SrsState
    states: dict[str, str]
