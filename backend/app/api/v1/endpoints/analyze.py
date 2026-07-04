"""
Text analysis endpoint — tokenize Japanese text and return enriched analysis.
"""

from fastapi import APIRouter, HTTPException

from app.models.analysis import AnalyzeRequest, AnalyzeResponse
from app.services.tokenizer import tokenizer_service
from app.services.dictionary import dictionary_service
from app.services.frequency import frequency_service

router = APIRouter()


@router.post("", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest):
    """
    Analyze Japanese text: tokenize, add readings, definitions,
    JLPT levels, and frequency data.
    """
    try:
        # Step 1: Tokenize with Sudachi
        raw_tokens = tokenizer_service.tokenize(request.text)

        # Step 2: Enrich tokens with dictionary, JLPT, frequency
        enriched_tokens = []
        for token in raw_tokens:
            # Add dictionary definitions
            if request.include_definitions and token.is_japanese:
                definitions = dictionary_service.lookup(token.dictionary_form)
                token.definitions = definitions

            # Add JLPT level
            jlpt = frequency_service.get_jlpt_level(token.dictionary_form)
            if jlpt:
                token.jlpt_level = jlpt

            # Add frequency rank
            freq = frequency_service.get_frequency_rank(token.dictionary_form)
            if freq:
                token.frequency_rank = freq

            enriched_tokens.append(token)

        # Build sentence reading
        sentence_reading = "".join(t.reading.hiragana for t in enriched_tokens)

        return AnalyzeResponse(
            text=request.text,
            tokens=enriched_tokens,
            sentence_reading=sentence_reading,
            token_count=len(enriched_tokens),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
