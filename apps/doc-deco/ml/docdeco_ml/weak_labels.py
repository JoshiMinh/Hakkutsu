from __future__ import annotations

import re

from .labels import DetailedRole

CAPTION = re.compile(r"^\s*(hình|ảnh|figure|bảng|table|biểu đồ|sơ đồ)\s*\d+", re.I)
DATE_LOCATION = re.compile(
    r"^\s*(?:đà nẵng|hà nội|tp\.?\s*hồ chí minh|huế|địa danh).*(?:19|20)\d{2}\s*$", re.I
)
META_AUTHOR = re.compile(r"^\s*(?:sinh viên|học viên|tác giả|mã sinh viên|lớp)\s*:", re.I)
META_SUPERVISOR = re.compile(r"^\s*(?:giảng viên|cán bộ)\s+(?:hướng dẫn|phản biện)\s*:", re.I)
USECASE_FIELD = re.compile(
    r"^\s*(?:use[\s-]?case|actors?|objective|pre-conditions?|post-conditions?|description|"
    r"trigger|ngoại lệ|điều kiện|tác nhân)\s*:", re.I
)
USECASE_NAME = re.compile(r"^\s*(?:use[\s-]?case\s+)?(?:login|register|check out|manage|view|post|add|make)\b", re.I)
FRONT_TITLES = {
    "lời cảm ơn", "lời nói đầu", "nhận xét của giảng viên hướng dẫn",
    "nhận xét của giảng viên phản biện", "mở đầu", "kết luận", "kết luận và hướng phát triển",
}
TOC_TITLES = {"mục lục"}
FIGURE_LIST_TITLES = {"danh mục hình", "danh mục hình vẽ", "danh mục bảng", "danh mục các từ viết tắt"}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).casefold()


def infer_zone(text: str, style: str, current_zone: str, index: int) -> str:
    value = normalize(text)
    lowered_style = style.casefold()
    if value in TOC_TITLES:
        return "toc"
    if value in FIGURE_LIST_TITLES:
        return "list_of_figures"
    if value in FRONT_TITLES:
        return "front_matter" if value not in {"mở đầu", "kết luận", "kết luận và hướng phát triển"} else "main"
    if re.match(r"^(chương|chapter)\s+\d+", value):
        return "main"
    if "table of contents" in lowered_style or lowered_style.startswith("toc"):
        return "toc"
    if "table of figures" in lowered_style:
        return "list_of_figures"
    if index < 40 and current_zone == "cover":
        return "cover"
    return current_zone


def weak_label(
    *,
    text: str,
    style: str,
    zone: str,
    features: dict[str, float],
    container: str,
) -> tuple[DetailedRole, float, str]:
    value = normalize(text)
    style_lower = style.casefold()
    if container == "header":
        return DetailedRole.HEADER, .99, "ooxml_container"
    if container == "footer":
        if value.isdigit():
            return DetailedRole.PAGE_NUMBER, .99, "ooxml_container"
        return DetailedRole.FOOTER, .99, "ooxml_container"
    if features.get("is_in_table"):
        return DetailedRole.TABLE_CONTENT, .9, "ooxml_table"
    if style_lower in {"title", "tiêu đề"}:
        return DetailedRole.DOCUMENT_TITLE, .99, "word_style"
    if style_lower.startswith("heading"):
        match = re.search(r"(\d+)", style_lower)
        level = min(int(match.group(1)) if match else 1, 4)
        return DetailedRole(f"heading_{level}"), .99, "word_style"
    if zone == "toc":
        return (DetailedRole.TOC_TITLE, .99, "zone_title") if value in TOC_TITLES else (
            DetailedRole.TOC_ENTRY, .95, "zone_context"
        )
    if zone == "list_of_figures":
        if value in FIGURE_LIST_TITLES:
            return DetailedRole.LIST_OF_FIGURES_TITLE, .99, "zone_title"
        return DetailedRole.LIST_OF_FIGURES_ENTRY, .95, "zone_context"
    if "caption" in style_lower or CAPTION.match(text):
        role = DetailedRole.TABLE_CAPTION if value.startswith(("bảng", "table")) else DetailedRole.FIGURE_CAPTION
        return role, .98, "caption_pattern"
    if zone == "cover":
        if "trường " in value or "university" in value:
            return DetailedRole.COVER_INSTITUTION, .9, "cover_pattern"
        if value.startswith(("khoa ", "faculty ")):
            return DetailedRole.COVER_FACULTY, .9, "cover_pattern"
        if re.search(r"(đồ án|khóa luận|báo cáo|luận văn)", value):
            if features.get("uppercase_ratio", 0) > .65 and len(value) > 25:
                return DetailedRole.DOCUMENT_TITLE, .82, "cover_layout"
            return DetailedRole.COVER_PROJECT_TYPE, .8, "cover_pattern"
        if META_AUTHOR.match(text):
            return DetailedRole.AUTHOR_METADATA, .95, "cover_pattern"
        if META_SUPERVISOR.match(text):
            return DetailedRole.SUPERVISOR_METADATA, .95, "cover_pattern"
        if DATE_LOCATION.match(text):
            return DetailedRole.DATE_LOCATION, .92, "cover_pattern"
        return DetailedRole.AUTHOR_METADATA, .55, "cover_fallback"
    if value in FRONT_TITLES:
        return DetailedRole.FRONT_MATTER_TITLE, .97, "front_matter_pattern"
    if USECASE_FIELD.match(text):
        return DetailedRole.USECASE_FIELD, .97, "usecase_pattern"
    if USECASE_NAME.match(text) and len(text) < 90:
        return DetailedRole.USECASE_NAME, .75, "usecase_pattern"
    if features.get("has_numbering") and features.get("outline_level", 9) <= 3:
        level = min(int(features["outline_level"]) + 1, 4)
        return DetailedRole(f"heading_{level}"), .88, "word_outline"
    if features.get("has_numbering") or "list" in style_lower:
        return DetailedRole.LIST_ITEM, .88, "word_numbering"
    if value.startswith(("ghi chú:", "lưu ý:", "note:")):
        return DetailedRole.NOTE, .95, "note_pattern"
    if text.strip().startswith(("“", '"', "「", "『")):
        return DetailedRole.QUOTE, .8, "quote_pattern"
    return DetailedRole.BODY, .75, "default_body"
