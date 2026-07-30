from __future__ import annotations

import random
from collections.abc import Iterator

from .labels import DetailedRole
from .records import FEATURE_NAMES, ParagraphRecord

INSTITUTIONS = [
    "TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN VÀ TRUYỀN THÔNG",
    "TRƯỜNG ĐẠI HỌC KHOA HỌC VÀ CÔNG NGHỆ",
    "VIETNAM - KOREA UNIVERSITY OF INFORMATION AND COMMUNICATION TECHNOLOGY",
]
FACULTIES = ["Khoa Khoa học máy tính", "Khoa Kỹ thuật phần mềm", "Khoa Công nghệ số"]
PROJECT_TYPES = ["ĐỒ ÁN CƠ SỞ", "BÁO CÁO THỰC TẬP", "KHÓA LUẬN TỐT NGHIỆP"]
TITLES = [
    "XÂY DỰNG ỨNG DỤNG QUẢN LÝ BÁN HÀNG",
    "HỆ THỐNG HỌC TỪ VỰNG TIẾNG NHẬT ĐA PHƯƠNG TIỆN",
    "ỨNG DỤNG TRÍ TUỆ NHÂN TẠO TRONG PHÂN TÍCH TÀI LIỆU",
    "XÂY DỰNG NỀN TẢNG QUẢN LÝ NỘI DUNG SỐ",
]
BODY_SENTENCES = [
    "Trong thời đại chuyển đổi số, nhu cầu quản lý và khai thác dữ liệu ngày càng trở nên quan trọng.",
    "Hệ thống được xây dựng nhằm hỗ trợ người dùng thao tác nhanh, chính xác và thuận tiện.",
    "Kết quả thực nghiệm cho thấy giải pháp có khả năng đáp ứng các yêu cầu chức năng đã đề ra.",
    "Phần này trình bày kiến trúc tổng thể, công nghệ sử dụng và phương pháp triển khai của đề tài.",
    "Dữ liệu được xử lý cục bộ để giảm độ trễ và bảo vệ thông tin của người sử dụng.",
]
SECTIONS = [
    ("TỔNG QUAN VỀ ĐỀ TÀI", ["Giới thiệu", "Mục tiêu", "Phạm vi nghiên cứu"]),
    ("NGHIÊN CỨU TỔNG QUAN", ["Cơ sở lý thuyết", "Công nghệ sử dụng", "Mô hình đề xuất"]),
    ("PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG", ["Biểu đồ Use Case", "Thiết kế dữ liệu", "Thiết kế giao diện"]),
    ("XÂY DỰNG VÀ KIỂM THỬ", ["Môi trường phát triển", "Kết quả triển khai", "Đánh giá"]),
]


def _features(rng: random.Random, role: DetailedRole, *, noisy: bool = False) -> dict[str, float]:
    result = {name: 0.0 for name in FEATURE_NAMES}
    heading_level = int(role.value[-1]) if role.value.startswith("heading_") else 0
    font_size = {
        DetailedRole.DOCUMENT_TITLE: 18,
        DetailedRole.COVER_INSTITUTION: 13,
        DetailedRole.COVER_PROJECT_TYPE: 14,
        DetailedRole.FRONT_MATTER_TITLE: 15,
        DetailedRole.TOC_TITLE: 15,
        DetailedRole.HEADING_1: 14,
        DetailedRole.HEADING_2: 13,
        DetailedRole.HEADING_3: 12,
        DetailedRole.HEADING_4: 11,
        DetailedRole.FIGURE_CAPTION: 10,
        DetailedRole.TABLE_CAPTION: 10,
    }.get(role, 12)
    result["font_size_mean"] = max(font_size + rng.uniform(-1, 1), 8) / 30
    result["font_size_max"] = result["font_size_mean"]
    result["bold_ratio"] = .9 if role in {
        DetailedRole.DOCUMENT_TITLE, DetailedRole.FRONT_MATTER_TITLE,
        DetailedRole.TOC_TITLE, DetailedRole.LIST_OF_FIGURES_TITLE,
        DetailedRole.HEADING_1, DetailedRole.HEADING_2, DetailedRole.HEADING_3,
        DetailedRole.HEADING_4, DetailedRole.USECASE_NAME,
    } else rng.uniform(0, .08)
    result["is_centered"] = float(role in {
        DetailedRole.COVER_INSTITUTION, DetailedRole.COVER_FACULTY,
        DetailedRole.COVER_PROJECT_TYPE, DetailedRole.DOCUMENT_TITLE,
        DetailedRole.DATE_LOCATION, DetailedRole.FRONT_MATTER_TITLE,
        DetailedRole.TOC_TITLE, DetailedRole.LIST_OF_FIGURES_TITLE,
        DetailedRole.FIGURE_CAPTION, DetailedRole.TABLE_CAPTION,
    })
    result["is_justified"] = float(role == DetailedRole.BODY)
    result["first_line_indent"] = .4 if role == DetailedRole.BODY else 0
    result["left_indent"] = .25 if role == DetailedRole.LIST_ITEM else 0
    result["has_numbering"] = float(heading_level > 0 or role == DetailedRole.LIST_ITEM)
    result["numbering_depth"] = float(heading_level)
    result["outline_level"] = float(heading_level - 1 if heading_level else 9)
    result["style_is_heading"] = float(heading_level > 0)
    result["style_is_caption"] = float(role in {DetailedRole.FIGURE_CAPTION, DetailedRole.TABLE_CAPTION})
    result["style_is_list"] = float(role == DetailedRole.LIST_ITEM)
    result["is_in_table"] = float(role == DetailedRole.TABLE_CONTENT)
    result["is_header"] = float(role == DetailedRole.HEADER)
    result["is_footer"] = float(role in {DetailedRole.FOOTER, DetailedRole.PAGE_NUMBER})
    if noisy:
        for name in ("style_is_heading", "style_is_caption", "style_is_list", "has_numbering"):
            if rng.random() < .45:
                result[name] = 0.0
        result["font_size_mean"] = max(result["font_size_mean"] + rng.uniform(-.08, .08), .25)
        result["is_centered"] = result["is_centered"] if rng.random() > .2 else 0.0
    return result


def _record(
    doc_id: str, index: int, text: str, role: DetailedRole, zone: str,
    rng: random.Random, *, noisy: bool,
) -> ParagraphRecord:
    features = _features(rng, role, noisy=noisy)
    features["char_length"] = min(len(text) / 500, 1)
    features["word_count"] = min(len(text.split()) / 100, 1)
    letters = [char for char in text if char.isalpha()]
    features["uppercase_ratio"] = sum(char.isupper() for char in letters) / max(len(letters), 1)
    style_name = "Normal" if noisy else {
        DetailedRole.DOCUMENT_TITLE: "Title",
        DetailedRole.HEADING_1: "Heading 1",
        DetailedRole.HEADING_2: "Heading 2",
        DetailedRole.HEADING_3: "Heading 3",
        DetailedRole.HEADING_4: "Heading 4",
        DetailedRole.FIGURE_CAPTION: "Caption",
        DetailedRole.TABLE_CAPTION: "Caption",
        DetailedRole.LIST_ITEM: "List Paragraph",
    }.get(role, "Normal")
    return ParagraphRecord(
        document_id=doc_id, paragraph_id=f"p-{index}", index=index,
        text=text, label=role.value, label_source="synthetic_exact",
        label_confidence=1.0, zone=zone, style_name=style_name, features=features,
    )


def synthetic_document(number: int, seed: int) -> list[ParagraphRecord]:
    rng = random.Random(seed * 100_003 + number)
    doc_id = f"synthetic-{seed}-{number:06d}"
    records: list[ParagraphRecord] = []
    noisy = rng.random() < .65

    def add(text: str, role: DetailedRole, zone: str) -> None:
        records.append(_record(doc_id, len(records), text, role, zone, rng, noisy=noisy))

    institution = rng.choice(INSTITUTIONS)
    if rng.random() < .35 and " VÀ " in institution:
        first, second = institution.split(" VÀ ", 1)
        add(f"{first} VÀ", DetailedRole.COVER_INSTITUTION, "cover")
        add(second, DetailedRole.COVER_INSTITUTION, "cover")
    else:
        add(institution, DetailedRole.COVER_INSTITUTION, "cover")
    add(rng.choice(FACULTIES), DetailedRole.COVER_FACULTY, "cover")
    add(rng.choice(PROJECT_TYPES), DetailedRole.COVER_PROJECT_TYPE, "cover")
    title = rng.choice(TITLES)
    if rng.random() < .3 and " " in title:
        words = title.split()
        midpoint = len(words) // 2
        add(" ".join(words[:midpoint]), DetailedRole.DOCUMENT_TITLE, "cover")
        add(" ".join(words[midpoint:]), DetailedRole.DOCUMENT_TITLE, "cover")
    else:
        add(title, DetailedRole.DOCUMENT_TITLE, "cover")
    add(f"Sinh viên thực hiện: Nguyễn Văn {rng.choice('ABCDE')}", DetailedRole.AUTHOR_METADATA, "cover")
    add(f"Lớp: {rng.randint(20, 26)}AI{rng.randint(1, 3)}", DetailedRole.AUTHOR_METADATA, "cover")
    add("Giảng viên hướng dẫn: ThS. Trần Minh Anh", DetailedRole.SUPERVISOR_METADATA, "cover")
    add(f"Đà Nẵng, tháng {rng.randint(1, 12)} năm {rng.randint(2023, 2027)}", DetailedRole.DATE_LOCATION, "cover")
    if rng.random() < .7:
        add("LỜI CẢM ƠN", DetailedRole.FRONT_MATTER_TITLE, "front_matter")
        add(rng.choice(BODY_SENTENCES), DetailedRole.BODY, "front_matter")
    add("MỤC LỤC", DetailedRole.TOC_TITLE, "toc")
    selected = rng.sample(SECTIONS, rng.randint(2, 4))
    for chapter_no, (chapter, subsections) in enumerate(selected, 1):
        add(f"Chương {chapter_no}. {chapter}", DetailedRole.TOC_ENTRY, "toc")
        for section_no, section in enumerate(subsections, 1):
            add(f"{chapter_no}.{section_no}. {section}", DetailedRole.TOC_ENTRY, "toc")
    add("DANH MỤC HÌNH VẼ", DetailedRole.LIST_OF_FIGURES_TITLE, "list_of_figures")
    for figure in range(1, rng.randint(3, 7)):
        add(f"Hình {figure}: Sơ đồ minh họa chức năng {figure}", DetailedRole.LIST_OF_FIGURES_ENTRY, "list_of_figures")
    add("MỞ ĐẦU", DetailedRole.FRONT_MATTER_TITLE, "main")
    add(rng.choice(BODY_SENTENCES), DetailedRole.BODY, "main")
    for chapter_no, (chapter, subsections) in enumerate(selected, 1):
        add(f"Chương {chapter_no}. {chapter}", DetailedRole.HEADING_1, "main")
        for section_no, section in enumerate(subsections, 1):
            add(f"{chapter_no}.{section_no}. {section}", DetailedRole.HEADING_2, "main")
            if rng.random() < .55:
                add(
                    f"{chapter_no}.{section_no}.1. Phân tích chi tiết",
                    DetailedRole.HEADING_3, "main",
                )
            if rng.random() < .25:
                add(
                    f"{chapter_no}.{section_no}.1.1. Trường hợp mở rộng",
                    DetailedRole.HEADING_4, "main",
                )
            for _ in range(rng.randint(1, 3)):
                add(rng.choice(BODY_SENTENCES), DetailedRole.BODY, "main")
            if rng.random() < .5:
                for item in range(1, rng.randint(2, 5)):
                    add(f"Nội dung thực hiện thứ {item}", DetailedRole.LIST_ITEM, "main")
            if "Use Case" in section and rng.random() < .9:
                add("Use-case: Đăng nhập", DetailedRole.USECASE_NAME, "main")
                add("Actors: Người dùng", DetailedRole.USECASE_FIELD, "main")
                add("Pre-conditions: Người dùng chưa đăng nhập", DetailedRole.USECASE_FIELD, "main")
                add("Objective: Truy cập vào hệ thống", DetailedRole.USECASE_FIELD, "main")
            if rng.random() < .55:
                add(f"Hình {len(records) % 30 + 1}: Kiến trúc chức năng", DetailedRole.FIGURE_CAPTION, "main")
            if rng.random() < .35:
                add(f"Bảng {len(records) % 20 + 1}: Kết quả kiểm thử", DetailedRole.TABLE_CAPTION, "main")
                add("STT | Chức năng | Kết quả", DetailedRole.TABLE_CONTENT, "main")
                add("1 | Đăng nhập | Đạt", DetailedRole.TABLE_CONTENT, "main")
            if rng.random() < .25:
                add("Lưu ý: dữ liệu thử nghiệm không chứa thông tin cá nhân.", DetailedRole.NOTE, "main")
            if rng.random() < .2:
                add("“Thiết kế tốt giúp người dùng hiểu hệ thống nhanh hơn.”", DetailedRole.QUOTE, "main")
    add("KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN", DetailedRole.FRONT_MATTER_TITLE, "main")
    add(rng.choice(BODY_SENTENCES), DetailedRole.BODY, "main")
    add("Tên đề tài - Báo cáo đồ án", DetailedRole.HEADER, "header")
    add("Khoa Khoa học máy tính", DetailedRole.FOOTER, "footer")
    add(str(rng.randint(1, 80)), DetailedRole.PAGE_NUMBER, "footer")
    for index, record in enumerate(records):
        record.previous_text = records[index - 1].text if index else ""
        record.next_text = records[index + 1].text if index + 1 < len(records) else ""
    return records


def generate_synthetic(count: int, seed: int = 20260729) -> Iterator[ParagraphRecord]:
    for number in range(count):
        yield from synthetic_document(number, seed)
