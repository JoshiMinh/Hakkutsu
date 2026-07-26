from pydantic import BaseModel, Field


class MangaCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    author: str = Field(default="", max_length=255)
    description: str = Field(default="", max_length=5000)
    tags: str = Field(default="", max_length=1000)


class ChapterCreate(BaseModel):
    chapter_number: str = Field(min_length=1, max_length=50)
    title: str = Field(default="", max_length=255)


class TextBlockInput(BaseModel):
    id: int | None = None
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    source_x: float | None = Field(default=None, ge=0)
    source_y: float | None = Field(default=None, ge=0)
    source_width: float | None = Field(default=None, gt=0)
    source_height: float | None = Field(default=None, gt=0)
    original_text: str = ""
    ai_translation: str = ""
    final_translation: str = ""
    font_family: str = "Arial"
    font_size: float = Field(default=28, ge=6, le=300)
    color: str = Field(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    text_align: str = Field(default="center", pattern=r"^(left|center|right)$")
    text_offset_y: float = Field(default=0, ge=-1000, le=1000)
    placement_anchor_x: float | None = Field(default=None, ge=0)
    placement_anchor_y: float | None = Field(default=None, ge=0)
    rotation: float = Field(default=0, ge=-360, le=360)
    ocr_confidence: float | None = Field(default=None, ge=0, le=1)
    ocr_provider: str | None = None
    text_kind: str = Field(default="dialogue", pattern=r"^(dialogue|sfx)$")
    content_type: str = Field(
        default="dialogue",
        pattern=r"^(dialogue|narration|skill|sfx|title|ignore)$",
    )
    translation_mode: str = Field(default="translate", pattern=r"^(translate|skip)$")
    render_mode: str = Field(default="replace", pattern=r"^(replace|preserve)$")
    style_preset: str = Field(
        default="dialogue",
        pattern=r"^(dialogue|narration|shout|action|brush|horror|skill)$",
    )
    policy_source: str = Field(default="auto", pattern=r"^(auto|manual)$")
    sfx_score: float = Field(default=0, ge=0, le=1)
    mask_strategy: str = Field(default="auto", pattern=r"^(auto|standard|aggressive|review)$")
    visual_confidence: float | None = Field(default=None, ge=0, le=1)
    visual_model: str | None = None
    visual_suggestion_json: str = "{}"
    policy_reasons_json: str = "[]"


class TextBlockBatch(BaseModel):
    blocks: list[TextBlockInput]


class OcrRequest(BaseModel):
    replace_existing: bool = False


class CropOcrRequest(BaseModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class TranslationRequest(BaseModel):
    overwrite_existing_ai: bool = False


class PipelineRequest(BaseModel):
    replace_existing: bool = False


class ImportFileInfo(BaseModel):
    name: str = Field(min_length=1, max_length=1000)
    content_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$")


class ImportCheckRequest(BaseModel):
    files: list[ImportFileInfo]


class ChapterReviewRequest(BaseModel):
    approved: bool = True
    override_warnings: bool = False


class PageReviewRequest(BaseModel):
    approved: bool = True
    override_warnings: bool = False


class PageEditorialDecisionRequest(BaseModel):
    decision: str = Field(pattern=r"^(auto|preserve_sfx|needs_manual_repair)$")
    note: str = Field(default="", max_length=1000)


class OutsideTextPolicyRequest(BaseModel):
    policy: str = Field(pattern=r"^(auto|replace|study|skip)$")


class PageOrderRequest(BaseModel):
    page_ids: list[int] = Field(min_length=1)


class ChapterPipelineRequest(BaseModel):
    include_warnings: bool = True


class TonariImportRequest(BaseModel):
    series_id: str = Field(min_length=1, max_length=100)
    episode_ids: list[str] = Field(min_length=1, max_length=30)


class VocabularyCreate(BaseModel):
    lemma: str = Field(min_length=1, max_length=255)
    reading: str = Field(default="", max_length=255)
    surface: str = Field(default="", max_length=255)
    meaning_vi: str = Field(default="", max_length=1000)
    source_sentence: str = Field(default="", max_length=2000)
    translation: str = Field(default="", max_length=2000)
    manga_title: str = Field(default="", max_length=255)
    chapter_number: str = Field(default="", max_length=50)
    page_number: int | None = Field(default=None, ge=1)
    source_kind: str = Field(default="manga", pattern=r"^(manga|youtube|netflix|subtitle_file|manual)$")
    source_url: str = Field(default="", max_length=2000)
    source_time: float | None = Field(default=None, ge=0)


class MediaSegmentInput(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    start: float = Field(default=0, ge=0)
    duration: float = Field(default=0, ge=0)


class MediaImportRequest(BaseModel):
    title: str = Field(default="", max_length=500)
    source_type: str = Field(default="manual", pattern=r"^(youtube|netflix|subtitle_file|manual)$")
    source_url: str = Field(default="", max_length=2000)
    external_id: str | None = Field(default=None, max_length=255)
    language: str = Field(default="ja", min_length=2, max_length=20)
    segments: list[MediaSegmentInput] = Field(min_length=1, max_length=10000)


class YoutubeMediaImportRequest(BaseModel):
    video_url: str = Field(min_length=10, max_length=2000)
    title: str = Field(default="", max_length=500)
    language: str = Field(default="ja", min_length=2, max_length=20)


class MediaAnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    translation: str = Field(default="", max_length=5000)
    context_type: str = Field(
        default="subtitle",
        pattern=r"^(subtitle|film_title|manga_dialogue)$",
    )
    include_definitions: bool = True


class WebTranslateRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=80)
    page_url: str = Field(default="", max_length=2000)
    page_title: str = Field(default="", max_length=500)
