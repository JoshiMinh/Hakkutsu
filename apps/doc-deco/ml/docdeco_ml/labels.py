from __future__ import annotations

from enum import StrEnum


class DetailedRole(StrEnum):
    COVER_INSTITUTION = "cover_institution"
    COVER_FACULTY = "cover_faculty"
    COVER_PROJECT_TYPE = "cover_project_type"
    DOCUMENT_TITLE = "document_title"
    AUTHOR_METADATA = "author_metadata"
    SUPERVISOR_METADATA = "supervisor_metadata"
    DATE_LOCATION = "date_location"
    FRONT_MATTER_TITLE = "front_matter_title"
    TOC_TITLE = "toc_title"
    TOC_ENTRY = "toc_entry"
    LIST_OF_FIGURES_TITLE = "list_of_figures_title"
    LIST_OF_FIGURES_ENTRY = "list_of_figures_entry"
    HEADING_1 = "heading_1"
    HEADING_2 = "heading_2"
    HEADING_3 = "heading_3"
    HEADING_4 = "heading_4"
    BODY = "body"
    LIST_ITEM = "list_item"
    FIGURE_CAPTION = "figure_caption"
    TABLE_CAPTION = "table_caption"
    USECASE_NAME = "usecase_name"
    USECASE_FIELD = "usecase_field"
    TABLE_CONTENT = "table_content"
    QUOTE = "quote"
    NOTE = "note"
    HEADER = "header"
    FOOTER = "footer"
    PAGE_NUMBER = "page_number"


LABELS = [role.value for role in DetailedRole]
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}
ID_TO_LABEL = dict(enumerate(LABELS))


STYLE_ROLE_MAP = {
    DetailedRole.COVER_INSTITUTION: "subtitle",
    DetailedRole.COVER_FACULTY: "subtitle",
    DetailedRole.COVER_PROJECT_TYPE: "subtitle",
    DetailedRole.DOCUMENT_TITLE: "title",
    DetailedRole.AUTHOR_METADATA: "body",
    DetailedRole.SUPERVISOR_METADATA: "body",
    DetailedRole.DATE_LOCATION: "body",
    DetailedRole.FRONT_MATTER_TITLE: "heading_1",
    DetailedRole.TOC_TITLE: "heading_1",
    DetailedRole.TOC_ENTRY: "body",
    DetailedRole.LIST_OF_FIGURES_TITLE: "heading_1",
    DetailedRole.LIST_OF_FIGURES_ENTRY: "body",
    DetailedRole.HEADING_1: "heading_1",
    DetailedRole.HEADING_2: "heading_2",
    DetailedRole.HEADING_3: "heading_3",
    DetailedRole.HEADING_4: "heading_3",
    DetailedRole.BODY: "body",
    DetailedRole.LIST_ITEM: "list_item",
    DetailedRole.FIGURE_CAPTION: "caption",
    DetailedRole.TABLE_CAPTION: "caption",
    DetailedRole.USECASE_NAME: "heading_3",
    DetailedRole.USECASE_FIELD: "body",
    DetailedRole.TABLE_CONTENT: "body",
    DetailedRole.QUOTE: "quote",
    DetailedRole.NOTE: "note",
    DetailedRole.HEADER: "body",
    DetailedRole.FOOTER: "body",
    DetailedRole.PAGE_NUMBER: "body",
}


def style_role_for(role: DetailedRole | str) -> str:
    return STYLE_ROLE_MAP[DetailedRole(role)]

