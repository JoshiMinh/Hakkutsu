from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
from threading import Lock
from typing import Protocol, List, Optional
import uuid

from PIL import Image

from app.core.config import settings
from app.models.manga_studio import TextBlockInput

@dataclass(frozen=True)
class OcrRegion:
    x: float
    y: float
    width: float
    height: float
    text: str
    confidence: Optional[float]
    source_x: Optional[float] = None
    source_y: Optional[float] = None
    source_width: Optional[float] = None
    source_height: Optional[float] = None


@dataclass(frozen=True)
class DetectedRegion:
    left: float
    top: float
    right: float
    bottom: float
    text: str
    confidence: float
    layout_left: Optional[float] = None
    layout_top: Optional[float] = None
    layout_right: Optional[float] = None
    layout_bottom: Optional[float] = None

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top


class OcrProvider(Protocol):
    name: str

    def recognize(self, image_path: Path) -> List[OcrRegion]: ...


class EasyOcrProvider:
    name = "easyocr"

    def __init__(self) -> None:
        try:
            import easyocr
            import torch
        except ImportError as exc:
            raise RuntimeError("EasyOCR chưa được cài đặt.") from exc

        if settings.OCR_GPU == "auto":
            use_gpu = bool(torch.cuda.is_available())
        else:
            use_gpu = settings.OCR_GPU in {"1", "true", "yes", "on"}

        model_dir = Path("app/data/models")
        model_dir.mkdir(parents=True, exist_ok=True)
        self._reader = None
        if settings.OCR_DETECTOR == "easyocr":
            self._reader = easyocr.Reader(
                settings.OCR_LANGUAGES,
                gpu=use_gpu,
                model_storage_directory=str(model_dir / "easyocr"),
                download_enabled=True,
                verbose=False,
            )
            
        self._comic_processor = None
        self._comic_detector = None
        self._torch = torch
        self._device = "cuda" if use_gpu else "cpu"
        
        if settings.OCR_DETECTOR == "comic":
            try:
                from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection
            except ImportError as exc:
                raise RuntimeError("Transformers with RT-DETR v2 support is required") from exc
            model_id = "ogkalu/comic-text-and-bubble-detector"
            os.environ.setdefault("HF_HOME", str(model_dir / "huggingface"))
            self._comic_processor = AutoImageProcessor.from_pretrained(model_id)
            self._comic_detector = RTDetrV2ForObjectDetection.from_pretrained(model_id)
            self._comic_detector.to(self._device).eval()
            self.name = "comic-text-bubble-detector"
        elif settings.OCR_DETECTOR != "easyocr":
            raise RuntimeError("OCR_DETECTOR must be 'comic' or 'easyocr'")
            
        self._manga_ocr = None
        if settings.OCR_RECOGNIZER == "manga_ocr" and "ja" in settings.OCR_LANGUAGES:
            os.environ.setdefault("HF_HOME", str(model_dir / "huggingface"))
            try:
                from manga_ocr import MangaOcr
            except ImportError as exc:
                raise RuntimeError("Manga-OCR chưa được cài đặt.") from exc
            self._manga_ocr = MangaOcr()
            self.name += "+manga-ocr"

    def recognize(self, image_path: Path) -> List[OcrRegion]:
        import numpy as np

        with Image.open(image_path) as image:
            rgb_image = image.convert("RGB")
            image_width, image_height = rgb_image.size
            image_array = np.asarray(rgb_image)

        if self._manga_ocr is not None and max(image_width, image_height) <= 512:
            text = str(self._manga_ocr(rgb_image)).strip()
            if text:
                return [OcrRegion(0, 0, float(image_width), float(image_height), text, None)]
            return []

        if self._comic_detector is not None:
            detected = self._detect_with_comic_model(rgb_image)
        else:
            raw_results = self._reader.readtext(
                image_array,
                detail=1,
                paragraph=False,
                batch_size=4,
                rotation_info=[90, 180, 270],
            )
            detected = group_detected_regions(
                detected_regions_from_easyocr(raw_results, image_width, image_height)
            )

        regions: List[OcrRegion] = []
        for detected_region in detected:
            left = detected_region.left
            top = detected_region.top
            right = detected_region.right
            bottom = detected_region.bottom
            width = detected_region.width
            height = detected_region.height
            easy_text = detected_region.text
            cleaned_text = easy_text
            region_confidence: Optional[float] = detected_region.confidence
            
            if self._manga_ocr is not None:
                is_vertical = height > width * 1.25
                padding_x = max(6, round(width * (0.22 if is_vertical else 0.08)))
                padding_y = max(6, round(height * (0.08 if is_vertical else 0.18)))
                crop_box = (
                    max(0, round(left) - padding_x),
                    max(0, round(top) - padding_y),
                    min(image_width, round(right) + padding_x),
                    min(image_height, round(bottom) + padding_y),
                )
                crop = rgb_image.crop(crop_box)
                manga_text = str(self._manga_ocr(crop)).strip()
                cleaned_text = choose_recognized_text(manga_text, easy_text)
                if cleaned_text == manga_text and JAPANESE_PATTERN.search(manga_text):
                    region_confidence = None
                    
            if not cleaned_text:
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
                    confidence=region_confidence,
                    source_x=left,
                    source_y=top,
                    source_width=width,
                    source_height=height,
                )
            )
        return regions

    def _detect_with_comic_model(self, image: Image.Image) -> List[DetectedRegion]:
        width, height = image.size
        inputs = self._comic_processor(images=image, return_tensors="pt")
        inputs = {key: value.to(self._device) for key, value in inputs.items()}
        with self._torch.inference_mode():
            outputs = self._comic_detector(**inputs)
        target_sizes = self._torch.tensor([[height, width]], device=self._device)
        result = self._comic_processor.post_process_object_detection(
            outputs,
            target_sizes=target_sizes,
            threshold=settings.OCR_DETECTION_THRESHOLD,
        )[0]
        return detected_regions_from_comic_model(
            result["boxes"].detach().cpu().tolist(),
            result["labels"].detach().cpu().tolist(),
            result["scores"].detach().cpu().tolist(),
            width,
            height,
        )


JAPANESE_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")

def choose_recognized_text(manga_text: str, easy_text: str) -> str:
    manga_text = manga_text.strip()
    easy_text = easy_text.strip()
    if manga_text and JAPANESE_PATTERN.search(manga_text):
        return manga_text
    return easy_text or manga_text

def detected_regions_from_easyocr(raw_results: list, image_width: int, image_height: int) -> List[DetectedRegion]:
    detected: List[DetectedRegion] = []
    for polygon, text, confidence in raw_results:
        xs = [float(point[0]) for point in polygon]
        ys = [float(point[1]) for point in polygon]
        left = max(0.0, min(xs))
        top = max(0.0, min(ys))
        right = min(float(image_width), max(xs))
        bottom = min(float(image_height), max(ys))
        if right - left < 1 or bottom - top < 1:
            continue
        detected.append(DetectedRegion(left, top, right, bottom, str(text).strip(), max(0.0, min(1.0, float(confidence)))))
    return detected

def detected_regions_from_comic_model(boxes: list[list[float]], labels: list[int], scores: list[float], image_width: int, image_height: int) -> List[DetectedRegion]:
    bubble_boxes: List[tuple[float, float, float, float, float]] = []
    text_boxes: List[tuple[float, float, float, float, float, int]] = []
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

    deduplicated: List[tuple[float, float, float, float, float, int]] = []
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
        candidates: List[tuple[float, int]] = []
        for bubble_index, bubble in enumerate(bubble_boxes):
            bubble_area = (bubble[2] - bubble[0]) * (bubble[3] - bubble[1])
            if bubble[0] <= center_x <= bubble[2] and bubble[1] <= center_y <= bubble[3] and text_area <= bubble_area <= text_area * 30:
                candidates.append((bubble_area, bubble_index))
        if candidates:
            _, bubble_index = min(candidates)
            grouped_by_bubble.setdefault(bubble_index, []).append(text_index)
            consumed.add(text_index)

    regions: List[DetectedRegion] = []
    for bubble_index, member_indices in grouped_by_bubble.items():
        members = [deduplicated[index] for index in member_indices]
        bubble = bubble_boxes[bubble_index]
        inset_x = (bubble[2] - bubble[0]) * 0.08
        inset_y = (bubble[3] - bubble[1]) * 0.08
        regions.append(DetectedRegion(min(item[0] for item in members), min(item[1] for item in members), max(item[2] for item in members), max(item[3] for item in members), "", sum(item[4] for item in members) / len(members), bubble[0] + inset_x, bubble[1] + inset_y, bubble[2] - inset_x, bubble[3] - inset_y))

    for index, item in enumerate(deduplicated):
        if index not in consumed:
            regions.append(DetectedRegion(item[0], item[1], item[2], item[3], "", item[4]))
    return sorted(regions, key=lambda region: (region.top, -region.left))

def group_detected_regions(regions: List[DetectedRegion]) -> List[DetectedRegion]:
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
    merged: List[DetectedRegion] = []
    for members in grouped.values():
        left = min(region.left for region in members)
        top = min(region.top for region in members)
        right = max(region.right for region in members)
        bottom = max(region.bottom for region in members)
        vertical = (bottom - top) > (right - left) * 1.25
        ordered = sorted(members, key=((lambda region: (-region.left, region.top)) if vertical else (lambda region: (region.top, region.left))))
        text = "".join(region.text for region in ordered if region.text)
        confidence = sum(region.confidence for region in members) / len(members)
        merged.append(DetectedRegion(left, top, right, bottom, text, confidence))
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
    same_vertical_run = x_overlap >= 0.5 and vertical_gap <= vertical_limit and (first_vertical or second_vertical or width_similarity >= 0.5)
    same_horizontal_run = y_overlap >= 0.5 and horizontal_gap <= horizontal_limit and (first_horizontal or second_horizontal or height_similarity >= 0.5)
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
    provider = get_ocr_provider()
    manga_ocr = getattr(provider, "_manga_ocr", None)
    if manga_ocr is None:
        return ""
    return str(manga_ocr(image.convert("RGB"))).strip()

def detect_text_blocks(image_path: Path) -> List[TextBlockInput]:
    """Runs OCR on the given image and returns a list of TextBlock inputs without DB dependency."""
    provider = get_ocr_provider()
    regions = provider.recognize(image_path)
    
    blocks = []
    for region in regions:
        blocks.append(TextBlockInput(
            id=str(uuid.uuid4()),
            x=region.x,
            y=region.y,
            width=region.width,
            height=region.height,
            source_x=region.source_x,
            source_y=region.source_y,
            source_width=region.source_width,
            source_height=region.source_height,
            original_text=region.text,
            ai_translation="",
            final_translation="",
            font_family="Arial",
            font_size=28,
            color="#000000",
            text_align="center",
            rotation=0.0,
            ocr_confidence=region.confidence,
            ocr_provider=provider.name
        ))
    return blocks
