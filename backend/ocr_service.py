from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
from threading import Lock
from typing import Protocol

import cv2
import numpy as np
from PIL import Image

from backend.config import (
    MODEL_DIR,
    OCR_DETECTION_THRESHOLD,
    OCR_DETECTOR,
    OCR_FALLBACK_THRESHOLD,
    OCR_FALLBACK_TILE_OVERLAP,
    OCR_FALLBACK_TILE_SIZE,
    OCR_GPU,
    OCR_LANGUAGES,
    OCR_RECOGNIZER,
)
from backend.database import db_session, utc_now

JAPANESE_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


def clean_manga_ocr_hallucination(manga_text: str, anchor_text: str = "") -> str:
    """Strip known autoregressive hallucinated conversational prefixes from Manga-OCR."""
    manga_text = manga_text.strip()
    if not manga_text:
        return ""

    # 1. Anchor alignment if anchor text is available
    if anchor_text:
        jp_chars = JAPANESE_PATTERN.findall(anchor_text)
        if len(jp_chars) >= 2:
            for n in (3, 2, 1):
                if len(jp_chars) >= n:
                    anchor = "".join(jp_chars[:n])
                    pos = manga_text.find(anchor)
                    if pos > 0:
                        manga_text = manga_text[pos:].strip()
                        break

    # 2. Known hallucination clause connectors pattern
    connector_match = re.search(
        r"^(?:.{2,60}?)(?:のですが|んだけど|ことですが|と言っていたのですが|付けられなかったのですが|と思ってい|と考えてい|知っていることですが|ここではない[。、,\s]+)[、,\s]+(?=[\u3400-\u9fff\u3040-\u30ff])",
        manga_text,
    )
    if connector_match:
        manga_text = manga_text[len(connector_match.group(0)):].strip()

    # 3. Clean leading punctuation noise
    manga_text = re.sub(r"^[\s\.\,\…\—\-\:\;]+", "", manga_text).strip()
    return manga_text


def segment_text_lines(rgb_array: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Segment horizontal text lines using Otsu thresholding and morphological filtering."""
    gray = cv2.cvtColor(rgb_array, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # Exclude thin horizontal colored underlines
    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
    lines_h = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_h)
    clean_binary = cv2.subtract(binary, lines_h)

    row_counts = np.sum(clean_binary > 0, axis=1)
    threshold_count = max(5, int(rgb_array.shape[1] * 0.01))

    in_line = False
    start_y = 0
    line_boxes: list[tuple[int, int, int, int]] = []

    for y, count in enumerate(row_counts):
        if count >= threshold_count and not in_line:
            in_line = True
            start_y = y
        elif count < threshold_count and in_line:
            in_line = False
            end_y = y
            if end_y - start_y >= 10:  # Min line height
                line_slice = clean_binary[start_y:end_y, :]
                cols = np.where(np.sum(line_slice > 0, axis=0) > 0)[0]
                if len(cols) > 0:
                    start_x = max(0, int(cols[0]) - 4)
                    end_x = min(rgb_array.shape[1], int(cols[-1]) + 4)
                    line_boxes.append((
                        start_x,
                        max(0, start_y - 4),
                        end_x - start_x,
                        min(rgb_array.shape[0], end_y + 4) - start_y,
                    ))

    return line_boxes


@dataclass(frozen=True)
class OcrRegion:
    x: float
    y: float
    width: float
    height: float
    text: str
    confidence: float | None
    source_x: float | None = None
    source_y: float | None = None
    source_width: float | None = None
    source_height: float | None = None


@dataclass(frozen=True)
class DetectedRegion:
    left: float
    top: float
    right: float
    bottom: float
    text: str
    confidence: float
    layout_left: float | None = None
    layout_top: float | None = None
    layout_right: float | None = None
    layout_bottom: float | None = None

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top


class OcrProvider(Protocol):
    name: str

    def recognize(self, image_path: Path) -> list[OcrRegion]: ...


class EasyOcrProvider:
    name = "easyocr"

    def __init__(self) -> None:
        try:
            import easyocr
            import torch
        except ImportError as exc:
            raise RuntimeError(
                "EasyOCR chưa được cài đặt. Hãy chạy: pip install -r requirements.txt"
            ) from exc

        if OCR_GPU == "auto":
            use_gpu = bool(torch.cuda.is_available())
        else:
            use_gpu = OCR_GPU in {"1", "true", "yes", "on"}

        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self._reader = None
        if OCR_DETECTOR == "easyocr":
            self._reader = easyocr.Reader(
                OCR_LANGUAGES,
                gpu=use_gpu,
                model_storage_directory=str(MODEL_DIR / "easyocr"),
                download_enabled=True,
                verbose=False,
            )
        self._comic_processor = None
        self._comic_detector = None
        self._torch = torch
        self._device = "cuda" if use_gpu else "cpu"
        if OCR_DETECTOR == "comic":
            try:
                from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection
            except ImportError as exc:
                raise RuntimeError("Transformers with RT-DETR v2 support is required") from exc
            model_id = "ogkalu/comic-text-and-bubble-detector"
            os.environ.setdefault("HF_HOME", str(MODEL_DIR / "huggingface"))
            self._comic_processor = AutoImageProcessor.from_pretrained(model_id)
            self._comic_detector = RTDetrV2ForObjectDetection.from_pretrained(model_id)
            self._comic_detector.to(self._device).eval()
            self.name = "comic-text-bubble-detector"
        elif OCR_DETECTOR != "easyocr":
            raise RuntimeError("OCR_DETECTOR must be 'comic' or 'easyocr'")
        self._manga_ocr = None
        if OCR_RECOGNIZER == "manga_ocr" and "ja" in OCR_LANGUAGES:
            os.environ.setdefault("HF_HOME", str(MODEL_DIR / "huggingface"))
            try:
                from manga_ocr import MangaOcr
            except ImportError as exc:
                raise RuntimeError(
                    "Manga-OCR chưa được cài đặt. Hãy chạy: pip install -r requirements.txt"
                ) from exc
            self._manga_ocr = MangaOcr()
            self.name += "+manga-ocr"

    def recognize(self, image_path: Path) -> list[OcrRegion]:
        with Image.open(image_path) as image:
            rgb_image = image.convert("RGB")
            image_width, image_height = rgb_image.size
            image_array = np.asarray(rgb_image)

        detected: list[DetectedRegion] = []
        if self._comic_detector is not None:
            detected = self._detect_with_comic_model(rgb_image)
            if not detected:
                detected = self._detect_with_tiled_comic_model(rgb_image)

        # Fallback to horizontal/vertical line segmentation if detector found no comic bubbles
        if not detected:
            line_boxes = segment_text_lines(image_array)
            for lx, ly, lw, lh in line_boxes:
                detected.append(
                    DetectedRegion(
                        float(lx),
                        float(ly),
                        float(lx + lw),
                        float(ly + lh),
                        "",
                        1.0,
                    )
                )

        # If still nothing detected (e.g. single small text snippet), use image bounds
        if not detected and self._manga_ocr is not None:
            raw_text = str(self._manga_ocr(rgb_image)).strip()
            cleaned = clean_manga_ocr_hallucination(raw_text)
            if cleaned and JAPANESE_PATTERN.search(cleaned):
                return [OcrRegion(0, 0, image_width, image_height, cleaned, 1.0)]
            return []

        regions: list[OcrRegion] = []
        for detected_region in detected:
            left = detected_region.left
            top = detected_region.top
            right = detected_region.right
            bottom = detected_region.bottom
            width = detected_region.width
            height = detected_region.height
            cleaned_text = detected_region.text

            if self._manga_ocr is not None:
                is_vertical = height > width * 1.25
                padding_x = max(2, round(width * (0.1 if is_vertical else 0.04)))
                padding_y = max(2, round(height * (0.04 if is_vertical else 0.1)))
                crop_box = (
                    max(0, round(left) - padding_x),
                    max(0, round(top) - padding_y),
                    min(image_width, round(right) + padding_x),
                    min(image_height, round(bottom) + padding_y),
                )
                crop = rgb_image.crop(crop_box)
                manga_text = str(self._manga_ocr(crop)).strip()
                cleaned_text = clean_manga_ocr_hallucination(manga_text, detected_region.text)

            # Skip lines with no Japanese characters (e.g. English subtitles)
            if not cleaned_text or not JAPANESE_PATTERN.search(cleaned_text):
                continue

            regions.append(
                OcrRegion(
                    x=detected_region.layout_left if detected_region.layout_left is not None else left,
                    y=detected_region.layout_top if detected_region.layout_top is not None else top,
                    width=(
                        detected_region.layout_right - detected_region.layout_left
                        if detected_region.layout_right is not None and detected_region.layout_left is not None
                        else width
                    ),
                    height=(
                        detected_region.layout_bottom - detected_region.layout_top
                        if detected_region.layout_bottom is not None and detected_region.layout_top is not None
                        else height
                    ),
                    text=cleaned_text,
                    confidence=detected_region.confidence,
                    source_x=left,
                    source_y=top,
                    source_width=width,
                    source_height=height,
                )
            )
        return regions

    def _ensure_easy_reader(self):
        if self._reader is None:
            import easyocr

            self._reader = easyocr.Reader(
                OCR_LANGUAGES,
                gpu=self._device == "cuda",
                model_storage_directory=str(MODEL_DIR / "easyocr"),
                download_enabled=True,
                verbose=False,
            )
        return self._reader

    def _detect_with_easyocr(self, image: Image.Image) -> list[DetectedRegion]:
        import numpy as np

        reader = self._ensure_easy_reader()
        raw_results = reader.readtext(
            np.asarray(image),
            detail=1,
            paragraph=False,
            batch_size=4,
            rotation_info=[90, 180, 270],
        )
        return group_detected_regions(
            detected_regions_from_easyocr(raw_results, image.width, image.height)
        )

    def _detect_with_comic_model(
        self, image: Image.Image, threshold: float | None = None
    ) -> list[DetectedRegion]:
        width, height = image.size
        inputs = self._comic_processor(images=image, return_tensors="pt")
        inputs = {key: value.to(self._device) for key, value in inputs.items()}
        with self._torch.inference_mode():
            outputs = self._comic_detector(**inputs)
        target_sizes = self._torch.tensor([[height, width]], device=self._device)
        result = self._comic_processor.post_process_object_detection(
            outputs,
            target_sizes=target_sizes,
            threshold=OCR_DETECTION_THRESHOLD if threshold is None else threshold,
        )[0]
        return detected_regions_from_comic_model(
            result["boxes"].detach().cpu().tolist(),
            result["labels"].detach().cpu().tolist(),
            result["scores"].detach().cpu().tolist(),
            width,
            height,
        )

    def _detect_with_tiled_comic_model(self, image: Image.Image) -> list[DetectedRegion]:
        tile_size = max(256, OCR_FALLBACK_TILE_SIZE)
        overlap = min(max(0, OCR_FALLBACK_TILE_OVERLAP), tile_size // 2)
        width, height = image.size
        translated: list[DetectedRegion] = []
        for left, top, right, bottom in tile_boxes(width, height, tile_size, overlap):
            crop = image.crop((left, top, right, bottom))
            for region in self._detect_with_comic_model(crop, OCR_FALLBACK_THRESHOLD):
                translated.append(
                    DetectedRegion(
                        region.left + left,
                        region.top + top,
                        region.right + left,
                        region.bottom + top,
                        region.text,
                        region.confidence,
                        region.layout_left + left if region.layout_left is not None else None,
                        region.layout_top + top if region.layout_top is not None else None,
                        region.layout_right + left if region.layout_right is not None else None,
                        region.layout_bottom + top if region.layout_bottom is not None else None,
                    )
                )
        return group_fallback_regions(translated)


JAPANESE_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")


def tile_boxes(
    image_width: int, image_height: int, tile_size: int, overlap: int
) -> list[tuple[int, int, int, int]]:
    """Cover an image completely with deterministic overlapping tiles."""
    step = max(1, tile_size - overlap)

    def starts(length: int) -> list[int]:
        if length <= tile_size:
            return [0]
        values = list(range(0, length - tile_size + 1, step))
        last = length - tile_size
        if values[-1] != last:
            values.append(last)
        return values

    return [
        (left, top, min(image_width, left + tile_size), min(image_height, top + tile_size))
        for top in starts(image_height)
        for left in starts(image_width)
    ]


def choose_recognized_text(manga_text: str, easy_text: str) -> str:
    """Prefer Manga-OCR only when it actually produced Japanese characters."""
    manga_text = manga_text.strip()
    easy_text = easy_text.strip()
    if manga_text and JAPANESE_PATTERN.search(manga_text):
        return manga_text
    return easy_text or manga_text


def detected_regions_from_easyocr(
    raw_results: list, image_width: int, image_height: int
) -> list[DetectedRegion]:
    detected: list[DetectedRegion] = []
    for polygon, text, confidence in raw_results:
        xs = [float(point[0]) for point in polygon]
        ys = [float(point[1]) for point in polygon]
        left = max(0.0, min(xs))
        top = max(0.0, min(ys))
        right = min(float(image_width), max(xs))
        bottom = min(float(image_height), max(ys))
        if right - left < 1 or bottom - top < 1:
            continue
        detected.append(
            DetectedRegion(
                left,
                top,
                right,
                bottom,
                str(text).strip(),
                max(0.0, min(1.0, float(confidence))),
            )
        )
    return detected


def detected_regions_from_comic_model(
    boxes: list[list[float]],
    labels: list[int],
    scores: list[float],
    image_width: int,
    image_height: int,
) -> list[DetectedRegion]:
    """Group text detections by speech bubble while keeping OCR crops tight."""
    bubble_boxes: list[tuple[float, float, float, float, float]] = []
    text_boxes: list[tuple[float, float, float, float, float, int]] = []
    for box, label, score in zip(boxes, labels, scores, strict=True):
        left = max(0.0, min(float(image_width), float(box[0])))
        top = max(0.0, min(float(image_height), float(box[1])))
        right = max(0.0, min(float(image_width), float(box[2])))
        bottom = max(0.0, min(float(image_height), float(box[3])))
        if right - left < 2 or bottom - top < 2:
            continue
        normalized_score = max(0.0, min(1.0, float(score)))
        if int(label) == 0:
            bubble_boxes.append((left, top, right, bottom, normalized_score))
        elif int(label) in {1, 2}:
            text_boxes.append((left, top, right, bottom, normalized_score, int(label)))

    # RT-DETR may return the same text as both text_bubble and text_free.
    deduplicated: list[tuple[float, float, float, float, float, int]] = []
    for candidate in sorted(text_boxes, key=lambda item: item[4], reverse=True):
        candidate_area = (candidate[2] - candidate[0]) * (candidate[3] - candidate[1])
        duplicate = False
        for kept in deduplicated:
            intersection_width = max(0.0, min(candidate[2], kept[2]) - max(candidate[0], kept[0]))
            intersection_height = max(0.0, min(candidate[3], kept[3]) - max(candidate[1], kept[1]))
            intersection = intersection_width * intersection_height
            kept_area = (kept[2] - kept[0]) * (kept[3] - kept[1])
            if intersection / max(1.0, min(candidate_area, kept_area)) >= 0.75:
                duplicate = True
                break
        if not duplicate:
            deduplicated.append(candidate)

    grouped_by_bubble: dict[int, list[int]] = {}
    consumed: set[int] = set()
    for text_index, text_box in enumerate(deduplicated):
        if text_box[5] != 1:
            continue
        center_x = (text_box[0] + text_box[2]) / 2
        center_y = (text_box[1] + text_box[3]) / 2
        text_area = (text_box[2] - text_box[0]) * (text_box[3] - text_box[1])
        candidates: list[tuple[float, int]] = []
        for bubble_index, bubble in enumerate(bubble_boxes):
            bubble_area = (bubble[2] - bubble[0]) * (bubble[3] - bubble[1])
            if (
                bubble[0] <= center_x <= bubble[2]
                and bubble[1] <= center_y <= bubble[3]
                and text_area <= bubble_area <= text_area * 30
            ):
                candidates.append((bubble_area, bubble_index))
        if candidates:
            _, bubble_index = min(candidates)
            grouped_by_bubble.setdefault(bubble_index, []).append(text_index)
            consumed.add(text_index)

    regions: list[DetectedRegion] = []
    for bubble_index, member_indices in grouped_by_bubble.items():
        members = [deduplicated[index] for index in member_indices]
        bubble = bubble_boxes[bubble_index]
        inset_x = (bubble[2] - bubble[0]) * 0.08
        inset_y = (bubble[3] - bubble[1]) * 0.08
        regions.append(
            DetectedRegion(
                min(item[0] for item in members),
                min(item[1] for item in members),
                max(item[2] for item in members),
                max(item[3] for item in members),
                "",
                sum(item[4] for item in members) / len(members),
                bubble[0] + inset_x,
                bubble[1] + inset_y,
                bubble[2] - inset_x,
                bubble[3] - inset_y,
            )
        )

    for index, item in enumerate(deduplicated):
        if index not in consumed:
            regions.append(DetectedRegion(item[0], item[1], item[2], item[3], "", item[4]))
    return sorted(regions, key=lambda region: (region.top, -region.left))


def group_detected_regions(regions: list[DetectedRegion]) -> list[DetectedRegion]:
    """Merge fragments that belong to the same vertical or horizontal text run."""
    if len(regions) < 2:
        return regions

    parents = list(range(len(regions)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parents[second_root] = first_root

    for first_index, first in enumerate(regions):
        for second_index in range(first_index + 1, len(regions)):
            second = regions[second_index]
            if regions_belong_together(first, second):
                union(first_index, second_index)

    grouped: dict[int, list[DetectedRegion]] = {}
    for index, region in enumerate(regions):
        grouped.setdefault(find(index), []).append(region)

    merged: list[DetectedRegion] = []
    for members in grouped.values():
        left = min(region.left for region in members)
        top = min(region.top for region in members)
        right = max(region.right for region in members)
        bottom = max(region.bottom for region in members)
        vertical = (bottom - top) > (right - left) * 1.25
        ordered = sorted(
            members,
            key=(
                (lambda region: (-region.left, region.top))
                if vertical
                else (lambda region: (region.top, region.left))
            ),
        )
        text = "".join(region.text for region in ordered if region.text)
        confidence = sum(region.confidence for region in members) / len(members)
        merged.append(DetectedRegion(left, top, right, bottom, text, confidence))

    return sorted(merged, key=lambda region: (region.top, -region.left))


def group_fallback_regions(regions: list[DetectedRegion]) -> list[DetectedRegion]:
    """Join widely spaced characters from large vertical/horizontal display text.

    This intentionally runs only after the normal full-page detector returned
    nothing. Display lettering often has gaps much larger than dialogue text.
    """
    if len(regions) < 2:
        return regions

    parents = list(range(len(regions)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(first: int, second: int) -> None:
        first_root, second_root = find(first), find(second)
        if first_root != second_root:
            parents[second_root] = first_root

    for first_index, first in enumerate(regions):
        for second_index in range(first_index + 1, len(regions)):
            second = regions[second_index]
            overlap_width = max(0.0, min(first.right, second.right) - max(first.left, second.left))
            overlap_height = max(0.0, min(first.bottom, second.bottom) - max(first.top, second.top))
            smaller_area = max(1.0, min(first.width * first.height, second.width * second.height))
            if overlap_width * overlap_height / smaller_area >= 0.5:
                union(first_index, second_index)
                continue

            x_overlap = overlap_width / max(1.0, min(first.width, second.width))
            y_overlap = overlap_height / max(1.0, min(first.height, second.height))
            vertical_gap = max(0.0, max(first.top, second.top) - min(first.bottom, second.bottom))
            horizontal_gap = max(0.0, max(first.left, second.left) - min(first.right, second.right))
            max_width = max(first.width, second.width)
            max_height = max(first.height, second.height)
            vertical_display_run = x_overlap >= 0.35 and vertical_gap <= max(80.0, max_width * 1.1)
            horizontal_display_run = y_overlap >= 0.35 and horizontal_gap <= max(80.0, max_height * 1.1)
            if vertical_display_run or horizontal_display_run:
                union(first_index, second_index)

    grouped: dict[int, list[DetectedRegion]] = {}
    for index, region in enumerate(regions):
        grouped.setdefault(find(index), []).append(region)

    merged: list[DetectedRegion] = []
    for members in grouped.values():
        merged.append(DetectedRegion(
            min(item.left for item in members),
            min(item.top for item in members),
            max(item.right for item in members),
            max(item.bottom for item in members),
            "",
            max(item.confidence for item in members),
        ))
    return sorted(merged, key=lambda region: (region.top, -region.left))


def regions_belong_together(first: DetectedRegion, second: DetectedRegion) -> bool:
    overlap_width = max(0.0, min(first.right, second.right) - max(first.left, second.left))
    overlap_height = max(0.0, min(first.bottom, second.bottom) - max(first.top, second.top))
    intersection = overlap_width * overlap_height
    smaller_area = min(first.width * first.height, second.width * second.height)
    if smaller_area > 0 and intersection / smaller_area >= 0.5:
        return True

    x_overlap = overlap_width / max(1.0, min(first.width, second.width))
    y_overlap = overlap_height / max(1.0, min(first.height, second.height))
    vertical_gap = max(0.0, max(first.top, second.top) - min(first.bottom, second.bottom))
    horizontal_gap = max(0.0, max(first.left, second.left) - min(first.right, second.right))
    vertical_limit = max(10.0, min(50.0, max(first.width, second.width) * 0.9))
    horizontal_limit = max(10.0, min(50.0, max(first.height, second.height) * 0.9))

    first_vertical = first.height >= first.width
    second_vertical = second.height >= second.width
    first_horizontal = first.width >= first.height
    second_horizontal = second.width >= second.height
    width_similarity = min(first.width, second.width) / max(first.width, second.width)
    height_similarity = min(first.height, second.height) / max(first.height, second.height)

    # Orientation/similarity guards prevent two complete, wide dialogue lines
    # that happen to be stacked from being merged into one huge region.
    same_vertical_run = (
        x_overlap >= 0.5
        and vertical_gap <= vertical_limit
        and (first_vertical or second_vertical or width_similarity >= 0.5)
    )
    same_horizontal_run = (
        y_overlap >= 0.5
        and horizontal_gap <= horizontal_limit
        and (first_horizontal or second_horizontal or height_similarity >= 0.5)
    )
    return same_vertical_run or same_horizontal_run


_provider: OcrProvider | None = None
_provider_lock = Lock()


def get_ocr_provider() -> OcrProvider:
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                _provider = EasyOcrProvider()
    return _provider


def recognize_japanese_crop(image: Image.Image) -> str:
    """Read a complete speech-bubble crop with Manga-OCR when available."""
    provider = get_ocr_provider()
    manga_ocr = getattr(provider, "_manga_ocr", None)
    if manga_ocr is None:
        return ""
    return str(manga_ocr(image.convert("RGB"))).strip()


def run_ocr_job(job_id: int, page_id: int, image_path: Path, replace_existing: bool) -> None:
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            "UPDATE processing_jobs SET status = 'processing', progress = 0.1, updated_at = ? WHERE id = ?",
            (now, job_id),
        )

    try:
        provider = get_ocr_provider()
        regions = provider.recognize(image_path)
        now = utc_now()
        with db_session() as connection:
            if replace_existing:
                connection.execute("DELETE FROM text_blocks WHERE page_id = ?", (page_id,))
            else:
                existing = connection.execute(
                    "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
                ).fetchone()[0]
                if existing:
                    raise RuntimeError("Trang đã có TextBlock; OCR bị dừng để bảo vệ dữ liệu chỉnh tay")

            for region in regions:
                connection.execute(
                    """
                    INSERT INTO text_blocks (
                        page_id, x, y, width, height, source_x, source_y, source_width,
                        source_height, original_text, ai_translation,
                        final_translation, font_family, font_size, color, text_align,
                        rotation, ocr_confidence, ocr_provider, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 'Arial', 28, '#000000', 'center', 0, ?, ?, ?, ?)
                    """,
                    (
                        page_id, region.x, region.y, region.width, region.height,
                        region.source_x, region.source_y, region.source_width, region.source_height,
                        region.text, region.confidence, provider.name, now, now,
                    ),
                )
            connection.execute(
                "UPDATE pages SET status = 'ready', updated_at = ? WHERE id = ?", (now, page_id)
            )
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'completed', progress = 1, result_count = ?, updated_at = ?
                WHERE id = ?
                """,
                (len(regions), now, job_id),
            )
    except Exception as exc:
        now = utc_now()
        message = str(exc).strip() or exc.__class__.__name__
        with db_session() as connection:
            connection.execute(
                "UPDATE pages SET status = 'failed', updated_at = ? WHERE id = ?", (now, page_id)
            )
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'failed', error_message = ?, updated_at = ?
                WHERE id = ?
                """,
                (message[:1000], now, job_id),
            )
