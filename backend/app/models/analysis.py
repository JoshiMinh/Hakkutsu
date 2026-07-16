"""
Pydantic models for text analysis requests and responses.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class GrammarPattern(BaseModel):
    """A matched Japanese grammar pattern."""
    
    pattern: str = Field(..., description="The grammar structure matched (e.g. ~なければならない)")
    meaning: str = Field(..., description="English meaning of the pattern")
    explanation: str = Field(..., description="Detailed explanation of how the grammar is used")
    jlpt_level: Optional[str] = Field(None, description="JLPT level of this grammar point")


class AnalyzeRequest(BaseModel):
    """Request body for text analysis."""

    text: str = Field(..., min_length=1, max_length=5000, description="Japanese text to analyze")
    include_definitions: bool = Field(True, description="Include dictionary definitions")
    include_examples: bool = Field(False, description="Include example sentences")
    user_id: Optional[str] = Field(None, description="Optional user ID to fetch SRS states")


class TokenReading(BaseModel):
    """Reading information for a token."""

    hiragana: str = Field(..., description="Hiragana reading")
    romaji: str = Field("", description="Romaji transliteration")


class DictionaryEntry(BaseModel):
    """A single dictionary definition."""

    glosses: List[str] = Field(..., description="English definitions")
    pos: List[str] = Field(default_factory=list, description="Parts of speech")
    field: Optional[str] = Field(None, description="Field of application")
    misc: List[str] = Field(default_factory=list, description="Miscellaneous info")


class TokenAnalysis(BaseModel):
    """Analysis result for a single token."""

    surface: str = Field(..., description="Surface form as it appears in text")
    dictionary_form: str = Field(..., description="Dictionary/base form")
    reading: TokenReading = Field(..., description="Reading information")
    pos: str = Field(..., description="Part of speech")
    pos_detail: List[str] = Field(default_factory=list, description="Detailed POS tags")
    is_japanese: bool = Field(True, description="Whether this token is Japanese")
    jlpt_level: Optional[str] = Field(None, description="JLPT level (N5-N1)")
    frequency_rank: Optional[int] = Field(None, description="Word frequency rank")
    definitions: List[DictionaryEntry] = Field(
        default_factory=list, description="Dictionary definitions"
    )
    srs_state: Optional[str] = Field(None, description="SRS state (e.g. new, learning, graduated)")


class AnalyzeResponse(BaseModel):
    """Response body for text analysis."""

    text: str = Field(..., description="Original input text")
    tokens: List[TokenAnalysis] = Field(..., description="Token analysis results")
    sentence_reading: str = Field("", description="Full sentence reading in hiragana")
    token_count: int = Field(..., description="Number of tokens")
    difficulty_score: Optional[float] = Field(
        None, description="AI difficulty score (Phase 2)"
    )
    difficulty_label: Optional[str] = Field(
        None, description="JLPT difficulty label (Phase 2)"
    )
    grammar_patterns: List[GrammarPattern] = Field(
        default_factory=list, description="Recognized grammar patterns in the text"
    )
