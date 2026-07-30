from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class SemanticRole(StrEnum):
    TITLE = "title"
    SUBTITLE = "subtitle"
    HEADING_1 = "heading_1"
    HEADING_2 = "heading_2"
    HEADING_3 = "heading_3"
    BODY = "body"
    LIST_ITEM = "list_item"
    QUOTE = "quote"
    CAPTION = "caption"
    NOTE = "note"


class ParagraphInput(BaseModel):
    paragraph_id: str
    text: str
    index: int = 0
    previous_text: str = ""
    next_text: str = ""
    current_style: str = ""
    layout_features: dict[str, float] = Field(default_factory=dict)
    is_first_non_empty: bool = False
    force_model: bool = False


class ClassifyRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=240)
    paragraph: ParagraphInput


class BatchClassifyRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=240)
    paragraphs: list[ParagraphInput] = Field(max_length=5000)


class Classification(BaseModel):
    paragraph_id: str
    text_hash: str
    role: SemanticRole
    level: int = 0
    confidence: float = Field(ge=0, le=1)
    source: str
    reason: str
    style_key: str
    semantic_label: str | None = None
    unchanged: bool = False


class FeedbackRequest(BaseModel):
    document_id: str
    paragraph_id: str
    text: str
    predicted_role: SemanticRole
    corrected_role: SemanticRole
    context: dict = Field(default_factory=dict)
