import asyncio

from docdeco import classifier
from docdeco.classifier import classify_rules
from docdeco.models import ParagraphInput, SemanticRole


def paragraph(text: str, **kwargs) -> ParagraphInput:
    return ParagraphInput(paragraph_id="p1", text=text, **kwargs)


def test_first_short_paragraph_is_title():
    assert classify_rules(paragraph("ỨNG DỤNG TRÍ TUỆ NHÂN TẠO", is_first_non_empty=True)).role == SemanticRole.TITLE


def test_numbered_headings_keep_depth():
    result = classify_rules(paragraph("2.3.1 Phương pháp nghiên cứu"))
    assert result.role == SemanticRole.HEADING_3
    assert result.level == 3


def test_body_and_list_are_separate():
    assert classify_rules(paragraph("- Nội dung thứ nhất")).role == SemanticRole.LIST_ITEM
    assert classify_rules(paragraph("Đây là một đoạn văn hoàn chỉnh mô tả nội dung của đề tài.")).role == SemanticRole.BODY


def test_caption_and_note():
    assert classify_rules(paragraph("Hình 2. Kiến trúc hệ thống")).role == SemanticRole.CAPTION
    assert classify_rules(paragraph("Lưu ý: dữ liệu chỉ dùng cho thử nghiệm")).role == SemanticRole.NOTE


def test_context_model_contract_and_role_mapping(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {"paragraph_id": "p1-previous", "label": "body", "confidence": .8},
                {"paragraph_id": "p1", "label": "heading_2", "confidence": .96},
                {"paragraph_id": "p1-next", "label": "body", "confidence": .8},
            ]

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json):
            captured["url"] = url
            captured["json"] = json
            return Response()

    monkeypatch.setattr(classifier.httpx, "AsyncClient", Client)
    item = paragraph(
        "1.2 Mục tiêu",
        index=8,
        previous_text="1. Tổng quan",
        next_text="Nội dung của mục tiêu.",
        current_style="Normal",
        layout_features={"bold_ratio": 1},
    )
    result = asyncio.run(classifier.classify_with_trained_model("doc-1", item))

    assert result is not None
    assert result.role == SemanticRole.HEADING_2
    assert result.semantic_label == "heading_2"
    assert captured["url"].endswith("/predict")
    assert captured["json"]["paragraphs"][1]["features"]["bold_ratio"] == 1
