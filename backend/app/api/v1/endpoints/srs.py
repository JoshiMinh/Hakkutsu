from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any
from app.models.srs import SrsCard, ReviewSubmit, SrsCardCreate, MinedSentenceCreate, HeatmapRequest, HeatmapResponse
from app.services.srs import SrsService

router = APIRouter()

# In a real app, you would have a get_current_user dependency that extracts user_id from the Firebase auth token.
# For simplicity, we will pass `user_id` as a query parameter or inside the request body for now.
# E.g. /api/v1/srs/due?user_id=123

@router.get("/due", response_model=List[SrsCard])
async def get_due_cards(user_id: str, limit: int = 50):
    """Get due cards for the given user."""
    return SrsService.get_due_cards(user_id, limit)

@router.post("/review", response_model=SrsCard)
async def submit_review(user_id: str, submit: ReviewSubmit):
    """Submit a review for a card."""
    card = SrsService.submit_review(user_id, submit)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found or unauthorized")
    return card

@router.post("/card", response_model=SrsCard)
async def add_card(card: SrsCardCreate):
    """Add a new word to the SRS."""
    new_card = SrsService.add_card(
        user_id=card.user_id,
        word=card.word,
        reading=card.reading,
        meaning=card.meaning,
        sentence=card.sentence
    )
    if not new_card:
        raise HTTPException(status_code=500, detail="Failed to add card")
    return new_card

@router.post("/mine")
async def mine_sentence(sentence: MinedSentenceCreate):
    """Mine a sentence for later study."""
    doc_id = SrsService.add_mined_sentence(
        user_id=sentence.user_id,
        sentence=sentence.sentence,
        source_url=sentence.source_url,
        source_title=sentence.source_title,
        target_word=sentence.target_word
    )
    if not doc_id:
        raise HTTPException(status_code=500, detail="Failed to save sentence")
    return {"id": doc_id, "status": "success"}

@router.post("/heatmap", response_model=HeatmapResponse)
async def get_heatmap_states(req: HeatmapRequest):
    """Get the SRS state of a list of words for coloring a heatmap."""
    states = SrsService.get_user_vocab_states(req.user_id, req.tokens)
    return HeatmapResponse(states=states)

@router.get("/stats")
async def get_srs_stats(user_id: str):
    """Get SRS summary stats."""
    return SrsService.get_stats(user_id)

@router.get("/cards", response_model=List[SrsCard])
async def get_all_cards(user_id: str):
    """Get all SRS cards for a user."""
    return SrsService.get_all_cards(user_id)
