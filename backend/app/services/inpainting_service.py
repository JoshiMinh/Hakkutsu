from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
from PIL import Image

from app.models.manga_studio import TextBlock


def create_text_mask(
    rgb_image: np.ndarray,
    boxes: List[Tuple[float, float, float, float]],
) -> np.ndarray:
    """Build a conservative stroke mask inside OCR text boxes."""
    image_height, image_width = rgb_image.shape[:2]
    gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)
    mask = np.zeros((image_height, image_width), dtype=np.uint8)
    line_protection = np.zeros_like(mask)
    edges = cv2.Canny(gray, 80, 180)
    minimum_line_length = max(40, round(min(image_height, image_width) * 0.04))
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(25, minimum_line_length // 2),
        minLineLength=minimum_line_length,
        maxLineGap=6,
    )
    if lines is not None:
        for line in lines.reshape(-1, 4):
            cv2.line(line_protection, tuple(line[:2]), tuple(line[2:]), 255, 3)

    for x, y, width, height in boxes:
        padding_x = max(3, round(width * 0.12))
        padding_y = max(3, round(height * 0.12))
        left = max(0, int(np.floor(x)) - padding_x)
        top = max(0, int(np.floor(y)) - padding_y)
        right = min(image_width, int(np.ceil(x + width)) + padding_x)
        bottom = min(image_height, int(np.ceil(y + height)) + padding_y)
        if right - left < 3 or bottom - top < 3:
            continue

        crop = gray[top:bottom, left:right]
        crop_height, crop_width = crop.shape
        border_size = max(1, min(crop_height, crop_width) // 10)
        border_pixels = np.concatenate(
            [
                crop[:border_size, :].ravel(),
                crop[-border_size:, :].ravel(),
                crop[:, :border_size].ravel(),
                crop[:, -border_size:].ravel(),
            ]
        )
        background = float(np.median(border_pixels))
        blur_size = max(3, (min(crop_height, crop_width) // 5) | 1)
        blur_size = min(31, blur_size)
        blurred = cv2.GaussianBlur(crop, (blur_size, blur_size), 0)

        if background >= 128:
            absolute = crop < min(220, background - 22)
            local = crop.astype(np.int16) < blurred.astype(np.int16) - 14
        else:
            absolute = crop > max(35, background + 22)
            local = crop.astype(np.int16) > blurred.astype(np.int16) + 14
        candidate = np.where(absolute & local, 255, 0).astype(np.uint8)

        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
        filtered = np.zeros_like(candidate)
        crop_area = crop_height * crop_width
        minimum_area = max(2, crop_area // 12000)
        maximum_area = max(20, int(crop_area * 0.22))
        for label in range(1, component_count):
            component_area = int(stats[label, cv2.CC_STAT_AREA])
            component_x = int(stats[label, cv2.CC_STAT_LEFT])
            component_y = int(stats[label, cv2.CC_STAT_TOP])
            component_width = int(stats[label, cv2.CC_STAT_WIDTH])
            component_height = int(stats[label, cv2.CC_STAT_HEIGHT])
            if not minimum_area <= component_area <= maximum_area:
                continue
            touches_edge = (
                component_x <= 1
                or component_y <= 1
                or component_x + component_width >= crop_width - 1
                or component_y + component_height >= crop_height - 1
            )
            if touches_edge:
                continue
            if component_width >= crop_width * 0.8 or component_height >= crop_height * 0.8:
                continue
            filtered[labels == label] = 255

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        filtered = cv2.morphologyEx(filtered, cv2.MORPH_CLOSE, kernel)
        filtered = cv2.dilate(filtered, kernel, iterations=2)

        protection_crop = line_protection[top:bottom, left:right]
        protected_from_edge = np.zeros_like(protection_crop)
        protection_count, protection_labels, _, _ = cv2.connectedComponentsWithStats(
            np.where(protection_crop > 0, 255, 0).astype(np.uint8), 8
        )
        for protection_label in range(1, protection_count):
            component = protection_labels == protection_label
            if (
                np.any(component[0, :]) or np.any(component[-1, :])
                or np.any(component[:, 0]) or np.any(component[:, -1])
            ):
                protected_from_edge[component] = 255
        filtered[protected_from_edge > 0] = 0
        mask[top:bottom, left:right] = cv2.bitwise_or(
            mask[top:bottom, left:right], filtered
        )

    return mask


def inpaint_text_regions(
    rgb_image: np.ndarray,
    boxes: List[Tuple[float, float, float, float]],
) -> Tuple[np.ndarray, np.ndarray]:
    mask = create_text_mask(rgb_image, boxes)
    radius = max(2.0, min(5.0, rgb_image.shape[1] / 600))
    bgr_image = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
    cleaned_bgr = cv2.inpaint(bgr_image, mask, radius, cv2.INPAINT_TELEA)
    cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)

    image_height, image_width = mask.shape
    for x, y, width, height in boxes:
        padding_x = max(3, round(width * 0.12))
        padding_y = max(3, round(height * 0.12))
        left = max(0, int(np.floor(x)) - padding_x)
        top = max(0, int(np.floor(y)) - padding_y)
        right = min(image_width, int(np.ceil(x + width)) + padding_x)
        bottom = min(image_height, int(np.ceil(y + height)) + padding_y)
        local_mask = mask[top:bottom, left:right] > 0
        if not np.any(local_mask):
            continue
        crop = rgb_image[top:bottom, left:right]
        border_size = max(1, min(crop.shape[:2]) // 10)
        border = np.concatenate(
            [
                crop[:border_size, :, :].reshape(-1, 3),
                crop[-border_size:, :, :].reshape(-1, 3),
                crop[:, :border_size, :].reshape(-1, 3),
                crop[:, -border_size:, :].reshape(-1, 3),
            ],
            axis=0,
        )
        median_color = np.median(border, axis=0)
        luminance = border.mean(axis=1)
        median_luminance = float(np.median(luminance))
        median_deviation = float(np.median(np.abs(luminance - median_luminance)))
        if median_deviation <= 18 and (median_luminance >= 205 or median_luminance <= 55):
            cleaned_crop = cleaned_rgb[top:bottom, left:right]
            cleaned_crop[local_mask] = np.clip(median_color, 0, 255).astype(np.uint8)

    return cleaned_rgb, mask


def process_inpainting(
    original_path: Path,
    destination: Path,
    preview_destination: Path,
    text_blocks: List[TextBlock]
) -> None:
    if not original_path.is_file():
        raise RuntimeError("Original image not found")
        
    boxes = [
        (
            block.source_x if block.source_x is not None else block.x,
            block.source_y if block.source_y is not None else block.y,
            block.source_width if block.source_width is not None else block.width,
            block.source_height if block.source_height is not None else block.height
        )
        for block in text_blocks
    ]
    
    with Image.open(original_path) as image:
        rgb_image = np.asarray(image.convert("RGB"))
        
    cleaned, mask = inpaint_text_regions(rgb_image, boxes)
    if not np.any(mask):
        raise RuntimeError("Failed to create text mask; image unchanged")

    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cleaned).save(destination, format="PNG", optimize=True)
    
    preview = rgb_image.astype(np.float32).copy()
    preview[mask > 0] = preview[mask > 0] * 0.45 + np.array([255, 35, 35]) * 0.55
    
    preview_destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(preview, 0, 255).astype(np.uint8)).save(
        preview_destination, format="PNG", optimize=True
    )
