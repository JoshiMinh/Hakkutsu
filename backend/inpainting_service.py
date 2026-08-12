from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from backend.ctd_mask_service import create_ctd_text_mask, ctd_available
from backend.database import db_session, utc_now
from backend.neural_inpainting_service import lama_available, lama_inpaint


class UnsafeTextMaskError(RuntimeError):
    """The generated mask is broad enough to destroy manga artwork."""


class InpaintingQualityError(RuntimeError):
    """The generated repair is visibly less plausible than its surroundings."""


def evaluate_inpainting_result(
    original: np.ndarray,
    candidate: np.ndarray,
    mask: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
) -> dict:
    """Detect black/white blobs and edits escaping the requested glyph mask.

    LaMa is deliberately kept as a pixel generator, not a quality judge. This
    deterministic gate compares every filled glyph with the nearby unmasked
    artwork. It works for both black-on-white and white-on-black lettering.
    """
    if candidate.shape != original.shape or mask.shape != original.shape[:2]:
        return {"acceptable": False, "score": 1.0, "reasons": ["Kích thước ảnh hậu kiểm không khớp"]}
    glyph_mask = mask > 0
    if not np.any(glyph_mask):
        return {"acceptable": False, "score": 1.0, "reasons": ["Mask chữ rỗng"]}

    original_gray = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    candidate_gray = cv2.cvtColor(candidate, cv2.COLOR_RGB2GRAY)
    pixel_change = np.max(
        np.abs(candidate.astype(np.int16) - original.astype(np.int16)), axis=2
    ) >= 18
    outside_change = float(np.mean(pixel_change & ~cv2.dilate(
        mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1
    ).astype(bool)))
    reasons: list[str] = []
    anomaly_score = min(1.0, outside_change * 25)
    if outside_change >= 0.004:
        reasons.append(f"thay đổi {outside_change:.1%} ảnh ngoài mask")

    image_height, image_width = mask.shape
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    for index, (x, y, width, height) in enumerate(boxes, start=1):
        left = max(0, int(np.floor(x)))
        top = max(0, int(np.floor(y)))
        right = min(image_width, int(np.ceil(x + width)))
        bottom = min(image_height, int(np.ceil(y + height)))
        if right <= left or bottom <= top:
            continue
        local_mask = glyph_mask[top:bottom, left:right]
        masked_pixels = int(np.count_nonzero(local_mask))
        if masked_pixels < 24:
            continue
        local_u8 = mask[top:bottom, left:right]
        ring = (cv2.dilate(local_u8, ring_kernel, iterations=2) > 0) & ~local_mask
        # Ignore page borders and empty rings; without context there is no safe
        # evidence for rejecting a generated fill.
        if int(np.count_nonzero(ring)) < 24:
            continue
        result_crop = candidate_gray[top:bottom, left:right]
        source_crop = original_gray[top:bottom, left:right]
        context_luma = float(np.median(result_crop[ring]))
        fill_luma = float(np.median(result_crop[local_mask]))
        dark_ratio = float(np.mean(result_crop[local_mask] <= 55))
        bright_ratio = float(np.mean(result_crop[local_mask] >= 210))
        newly_dark = float(np.mean(
            (result_crop[local_mask] <= 55) & (source_crop[local_mask] >= 105)
        ))
        newly_bright = float(np.mean(
            (result_crop[local_mask] >= 210) & (source_crop[local_mask] <= 155)
        ))

        dark_blob = context_luma >= 135 and (
            (fill_luma <= context_luma - 72 and dark_ratio >= 0.38)
            or newly_dark >= 0.30
        )
        white_blob = context_luma <= 115 and (
            (fill_luma >= context_luma + 82 and bright_ratio >= 0.52)
            or newly_bright >= 0.42
        )
        if dark_blob:
            severity = max(dark_ratio, newly_dark)
            anomaly_score = max(anomaly_score, severity)
            reasons.append(f"vùng {index} sinh mảng đen bất thường ({severity:.0%})")
        elif white_blob:
            severity = max(bright_ratio, newly_bright)
            anomaly_score = max(anomaly_score, severity)
            reasons.append(f"vùng {index} sinh mảng trắng bất thường ({severity:.0%})")

    return {
        "acceptable": not reasons,
        "score": round(float(anomaly_score), 4),
        "reasons": reasons,
    }


def validate_text_mask_safety(
    mask: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    learned_mask: bool = False,
) -> None:
    """Reject broad masks before either LaMa or OpenCV modifies the image."""
    image_height, image_width = mask.shape
    image_area = max(1, image_height * image_width)
    for index, (x, y, width, height) in enumerate(boxes, start=1):
        left = max(0, int(np.floor(x)))
        top = max(0, int(np.floor(y)))
        right = min(image_width, int(np.ceil(x + width)))
        bottom = min(image_height, int(np.ceil(y + height)))
        if right <= left or bottom <= top:
            continue
        crop = mask[top:bottom, left:right]
        coverage = float(np.mean(crop > 0))
        box_fraction = float(crop.size / image_area)
        # Dense dialogue in a small balloon can legitimately cover much of its
        # crop. A large display-text box covering artwork cannot: in that case
        # thresholding has selected characters, speed lines and scenery too.
        # A learned glyph mask may legitimately cover most of a tight box for
        # giant SFX. The former universal 62% gate blocked correct 83-85% masks
        # before LaMa was even called. Classical threshold masks remain strict
        # because they often absorb speed lines and character artwork.
        unsafe_dense = coverage >= (0.92 if learned_mask else 0.62)
        if unsafe_dense or (not learned_mask and box_fraction >= 0.035 and coverage >= 0.40):
            raise UnsafeTextMaskError(
                f"Mask vùng {index} phủ {coverage:.0%} khung chữ và có thể xóa nét tranh. "
                "Ảnh gốc được giữ nguyên; hãy thu hẹp vùng hoặc dùng mask chữ chuyên dụng."
            )


def shrink_unsafe_text_mask(
    mask: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    target_coverage: float = 0.30,
) -> tuple[np.ndarray, bool]:
    """Erode only unsafe text regions instead of cancelling automatic work."""
    safe = mask.copy()
    image_height, image_width = safe.shape
    adjusted = False
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for x, y, width, height in boxes:
        padding_x = max(3, round(width * 0.12))
        padding_y = max(3, round(height * 0.12))
        left = max(0, int(np.floor(x)) - padding_x)
        top = max(0, int(np.floor(y)) - padding_y)
        right = min(image_width, int(np.ceil(x + width)) + padding_x)
        bottom = min(image_height, int(np.ceil(y + height)) + padding_y)
        box_left = max(0, int(np.floor(x)))
        box_top = max(0, int(np.floor(y)))
        box_right = min(image_width, int(np.ceil(x + width)))
        box_bottom = min(image_height, int(np.ceil(y + height)))
        if right <= left or bottom <= top or box_right <= box_left or box_bottom <= box_top:
            continue
        box_view = safe[box_top:box_bottom, box_left:box_right]
        if float(np.mean(box_view > 0)) < 0.40:
            continue
        adjusted = True
        region = safe[top:bottom, left:right].copy()
        previous = region
        for _ in range(24):
            candidate = cv2.erode(previous, kernel, iterations=1)
            if not np.any(candidate):
                break
            safe[top:bottom, left:right] = candidate
            coverage = float(np.mean(safe[box_top:box_bottom, box_left:box_right] > 0))
            previous = candidate
            if coverage <= target_coverage:
                break
        safe[top:bottom, left:right] = previous
    return safe, adjusted


def create_text_mask(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    aggressive: bool = False,
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
        padding_ratio = 0.17 if aggressive else 0.12
        padding_x = max(3, round(width * padding_ratio))
        padding_y = max(3, round(height * padding_ratio))
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

        contrast_gap = 14 if aggressive else 22
        local_gap = 9 if aggressive else 14
        if background >= 128:
            absolute = crop < min(228, background - contrast_gap)
            local = crop.astype(np.int16) < blurred.astype(np.int16) - local_gap
        else:
            absolute = crop > max(27, background + contrast_gap)
            local = crop.astype(np.int16) > blurred.astype(np.int16) + local_gap
        candidate = np.where(absolute & local, 255, 0).astype(np.uint8)

        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
        filtered = np.zeros_like(candidate)
        crop_area = crop_height * crop_width
        minimum_area = max(2, crop_area // 12000)
        maximum_area = max(20, int(crop_area * (0.45 if aggressive else 0.22)))
        for label in range(1, component_count):
            component_area = int(stats[label, cv2.CC_STAT_AREA])
            component_x = int(stats[label, cv2.CC_STAT_LEFT])
            component_y = int(stats[label, cv2.CC_STAT_TOP])
            component_width = int(stats[label, cv2.CC_STAT_WIDTH])
            component_height = int(stats[label, cv2.CC_STAT_HEIGHT])
            if not minimum_area <= component_area <= maximum_area:
                continue
            touches_crop_edge = (
                component_x <= 1
                or component_y <= 1
                or component_x + component_width >= crop_width - 1
                or component_y + component_height >= crop_height - 1
            )
            source_box_touches_image = (
                x <= 1 or y <= 1
                or x + width >= image_width - 1
                or y + height >= image_height - 1
            )
            # Curved balloon outlines and nearby artwork enter through the
            # padded crop edge. Text is allowed there only when the OCR box
            # itself is genuinely clipped by the page boundary.
            if touches_crop_edge and not source_box_touches_image:
                continue
            maximum_span = 0.95 if aggressive else 0.8
            if component_width >= crop_width * maximum_span or component_height >= crop_height * maximum_span:
                continue
            filtered[labels == label] = 255

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        filtered = cv2.morphologyEx(filtered, cv2.MORPH_CLOSE, kernel)
        if aggressive:
            dilation_iterations = max(5, min(9, round(min(crop_height, crop_width) / 42)))
        else:
            dilation_iterations = max(2, min(4, round(min(crop_height, crop_width) / 65)))
        filtered = cv2.dilate(filtered, kernel, iterations=dilation_iterations)

        # Only protect long lines that actually enter/leave this OCR crop.
        # A vertical run of Japanese glyphs can also trigger Hough, but unlike
        # a panel border or decorative stroke it remains fully inside the crop.
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


def _missing_long_axis_segments(
    mask: np.ndarray,
    box: tuple[float, float, float, float],
) -> list[tuple[float, float, float, float]]:
    """Find empty sections inside a long SFX block for a narrow fallback pass."""
    x, y, width, height = box
    image_height, image_width = mask.shape
    aspect = max(width / max(1.0, height), height / max(1.0, width))
    if aspect < 1.7:
        return []
    segments = max(4, min(7, round(aspect * 2)))
    missing: list[tuple[float, float, float, float]] = []
    vertical = height >= width
    for index in range(segments):
        if vertical:
            start = y + height * index / segments
            end = y + height * (index + 1) / segments
            left, top = max(0, int(x)), max(0, int(start))
            right, bottom = min(image_width, int(np.ceil(x + width))), min(image_height, int(np.ceil(end)))
        else:
            start = x + width * index / segments
            end = x + width * (index + 1) / segments
            left, top = max(0, int(start)), max(0, int(y))
            right, bottom = min(image_width, int(np.ceil(end))), min(image_height, int(np.ceil(y + height)))
        if right <= left or bottom <= top:
            continue
        coverage = float(np.mean(mask[top:bottom, left:right] > 0))
        if coverage >= 0.008:
            continue
        overlap = 0.08
        if vertical:
            segment_height = end - start
            missing.append((x, max(y, start - segment_height * overlap), width,
                            min(y + height, end + segment_height * overlap) - max(y, start - segment_height * overlap)))
        else:
            segment_width = end - start
            missing.append((max(x, start - segment_width * overlap), y,
                            min(x + width, end + segment_width * overlap) - max(x, start - segment_width * overlap), height))
    return missing


def create_primary_text_mask(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    aggressive_fallback: bool = False,
) -> tuple[np.ndarray, str]:
    """Prefer the learned glyph mask and fall back per missing OCR region."""
    if not boxes:
        return np.zeros(rgb_image.shape[:2], dtype=np.uint8), "empty"

    if ctd_available():
        try:
            mask = create_ctd_text_mask(rgb_image, boxes)
            missing_boxes: list[tuple[float, float, float, float]] = []
            image_height, image_width = mask.shape
            for box in boxes:
                x, y, width, height = box
                left = max(0, int(np.floor(x)))
                top = max(0, int(np.floor(y)))
                right = min(image_width, int(np.ceil(x + width)))
                bottom = min(image_height, int(np.ceil(y + height)))
                pixels = int(np.count_nonzero(mask[top:bottom, left:right]))
                minimum = max(8, round(max(1, (right - left) * (bottom - top)) * 0.0005))
                if pixels < minimum:
                    missing_boxes.append(box)
                elif aggressive_fallback:
                    missing_boxes.extend(_missing_long_axis_segments(mask, box))
            if missing_boxes:
                fallback = create_text_mask(
                    rgb_image,
                    missing_boxes,
                    aggressive=aggressive_fallback,
                )
                if aggressive_fallback and np.any(fallback):
                    # Missing bands are usually oversized outlined SFX glyphs.
                    # Their black/white decoration is much thicker than normal
                    # dialogue anti-aliasing, so grow only this fallback mask.
                    fallback = cv2.dilate(
                        fallback,
                        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
                        iterations=6,
                    )
                mask = cv2.bitwise_or(mask, fallback)
                return mask, "ctd+opencv"
            if np.any(mask):
                return mask, "ctd"
        except Exception:
            # Keep the editor one-click if the optional model/CUDA fails.
            pass

    return (
        create_text_mask(rgb_image, boxes, aggressive=aggressive_fallback),
        "opencv",
    )


def inpaint_text_regions(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    supplied_mask = mask is not None
    if mask is None:
        mask = create_text_mask(rgb_image, boxes)
    radius = max(2.0, min(5.0, rgb_image.shape[1] / 600))
    bgr_image = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
    cleaned_bgr = cv2.inpaint(bgr_image, mask, radius, cv2.INPAINT_TELEA)
    cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)

    # A second conservative pass catches anti-aliased fringes immediately
    # around the first mask without expanding into unrelated manga artwork.
    if np.any(mask) and not supplied_mask:
        residual = create_text_mask(cleaned_rgb, boxes)
        nearby = cv2.dilate(
            mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=2
        )
        extra = cv2.bitwise_and(residual, nearby)
        if np.any(extra):
            mask = cv2.bitwise_or(mask, extra)
            cleaned_bgr = cv2.inpaint(bgr_image, mask, radius, cv2.INPAINT_TELEA)
            cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)

    # Flat black/white speech-bubble backgrounds are safer and cleaner when
    # filled with their local median instead of synthesized by inpainting.
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


def _has_complex_background(
    rgb_image: np.ndarray,
    box: tuple[float, float, float, float],
    mask: np.ndarray | None = None,
) -> bool:
    x, y, width, height = box
    image_height, image_width = rgb_image.shape[:2]
    left = max(0, int(np.floor(x)))
    top = max(0, int(np.floor(y)))
    right = min(image_width, int(np.ceil(x + width)))
    bottom = min(image_height, int(np.ceil(y + height)))
    if right <= left or bottom <= top:
        return False
    crop = rgb_image[top:bottom, left:right]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)

    # Check background variance outside the text strokes
    if mask is not None:
        local_mask = mask[top:bottom, left:right] > 0
        bg_pixels = gray[~local_mask]
        if bg_pixels.size >= 16:
            return float(bg_pixels.std()) >= 28

    # If no mask or sparse background, check border ring pixels
    border_size = max(1, min(gray.shape) // 10)
    border_pixels = np.concatenate([
        gray[:border_size, :].ravel(),
        gray[-border_size:, :].ravel(),
        gray[:, :border_size].ravel(),
        gray[:, -border_size:].ravel(),
    ])
    return float(border_pixels.std()) >= 28


def _expand_ctd_outline_mask(
    mask: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    *,
    iterations: int = 3,
) -> np.ndarray:
    """Cover decorative SFX outlines while staying inside requested regions."""
    expanded = cv2.dilate(
        mask,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=max(1, iterations),
    )
    allowed = np.zeros_like(mask)
    image_height, image_width = mask.shape
    for x, y, width, height in boxes:
        pad_x = max(3, round(width * 0.04))
        pad_y = max(3, round(height * 0.04))
        left = max(0, int(np.floor(x)) - pad_x)
        top = max(0, int(np.floor(y)) - pad_y)
        right = min(image_width, int(np.ceil(x + width)) + pad_x)
        bottom = min(image_height, int(np.ceil(y + height)) + pad_y)
        allowed[top:bottom, left:right] = 255
    return cv2.bitwise_and(expanded, allowed)


def _inpaint_text_regions_hybrid_legacy(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    block_metadata: list[dict],
) -> tuple[np.ndarray, np.ndarray, str]:
    use_lama = lama_available() and any(
        str(meta.get("text_kind") or "") == "sfx"
        or float(meta.get("sfx_score") or 0) >= 0.6
        or _has_complex_background(rgb_image, box)
        for box, meta in zip(boxes, block_metadata)
    )
    if not use_lama:
        cleaned, mask = inpaint_text_regions(rgb_image, boxes)
        validate_text_mask_safety(mask, boxes)
        return cleaned, mask, "telea"

    mask = create_text_mask(rgb_image, boxes, aggressive=True)
    if not np.any(mask):
        raise RuntimeError("Không tạo được mask chữ cho LaMa")
    mask, mask_was_shrunk = shrink_unsafe_text_mask(mask, boxes)
    validate_text_mask_safety(mask, boxes)
    try:
        engine = "lama_mask_co" if mask_was_shrunk else "lama"
        return lama_inpaint(rgb_image, mask), mask, engine
    except Exception:
        # Keep the editor usable if the optional model is corrupt or the
        # machine runs out of memory. QA will still detect residual text.
        cleaned, fallback_mask = inpaint_text_regions(rgb_image, boxes)
        return cleaned, fallback_mask, "telea_fallback"


def inpaint_text_regions_hybrid(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    block_metadata: list[dict],
) -> tuple[np.ndarray, np.ndarray, str]:
    """Use CTD glyph segmentation first, then LaMa/Telea to fill that mask."""
    aggressive_visual = any(
        str(meta.get("mask_strategy") or "") == "aggressive"
        for meta in block_metadata
    )
    mask, mask_source = create_primary_text_mask(
        rgb_image,
        boxes,
        aggressive_fallback=True,
    )
    if not np.any(mask):
        raise RuntimeError("Không tạo được mask nét chữ; ảnh gốc được giữ nguyên")

    is_learned = mask_source.startswith("ctd")
    mask_was_shrunk = False
    if is_learned:
        mask = _expand_ctd_outline_mask(mask, boxes, iterations=5 if aggressive_visual else 3)
    else:
        mask, mask_was_shrunk = shrink_unsafe_text_mask(mask, boxes)

    validate_text_mask_safety(mask, boxes, learned_mask=is_learned)

    use_lama = lama_available() and any(
        str(meta.get("text_kind") or "") == "sfx"
        or float(meta.get("sfx_score") or 0) >= 0.6
        or str(meta.get("mask_strategy") or "") in {"aggressive", "review"}
        or _has_complex_background(rgb_image, box, mask)
        for box, meta in zip(boxes, block_metadata)
    )

    suffix = "_mask_co" if mask_was_shrunk else ""
    visual_suffix = "_visual_aggressive" if aggressive_visual else ""
    lama_failure = ""

    if use_lama:
        try:
            lama_result = lama_inpaint(rgb_image, mask)
            lama_quality = evaluate_inpainting_result(rgb_image, lama_result, mask, boxes)
            if lama_quality["acceptable"]:
                return lama_result, mask, f"lama_{mask_source}{visual_suffix}{suffix}_qa"
            lama_failure = "; ".join(lama_quality["reasons"])
        except Exception as exc:
            lama_failure = str(exc).strip() or exc.__class__.__name__

    # Telea inpainting (default for flat backgrounds, or fallback when LaMa fails QA)
    telea_result, fallback_mask = inpaint_text_regions(rgb_image, boxes, mask=mask)
    telea_quality = evaluate_inpainting_result(rgb_image, telea_result, fallback_mask, boxes)
    if telea_quality["acceptable"]:
        engine_name = (
            f"lama_{mask_source}_telea_qa_fallback"
            if (use_lama and lama_failure)
            else f"telea_{mask_source}"
        )
        return telea_result, fallback_mask, engine_name

    fallback_failure = "; ".join(telea_quality["reasons"])
    raise InpaintingQualityError(
        "Hậu kiểm đã từ chối kết quả xóa để tránh lưu mảng hỏng. "
        f"LaMa: {lama_failure or 'không áp dụng'}; Telea: {fallback_failure or 'không đạt'}. "
        "Ảnh sạch cũ được giữ nguyên."
    )


def run_inpainting_job(
    job_id: int,
    page_id: int,
    original_path: Path,
    destination: Path,
    relative_path: str,
    preview_destination: Path,
    preview_relative_path: str,
) -> None:
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            "UPDATE processing_jobs SET status = 'processing', progress = 0.1, updated_at = ? WHERE id = ?",
            (now, job_id),
        )
        rows = connection.execute(
            """
            SELECT COALESCE(source_x, x) AS source_x,
                   COALESCE(source_y, y) AS source_y,
                   COALESCE(source_width, width) AS source_width,
                   COALESCE(source_height, height) AS source_height,
                   text_kind, sfx_score, mask_strategy, visual_confidence, visual_model
            FROM text_blocks
            WHERE page_id = ? AND COALESCE(render_mode, 'replace') = 'replace'
              AND COALESCE(translation_mode, 'translate') = 'translate'
            ORDER BY id
            """,
            (page_id,),
        ).fetchall()

    try:
        if not original_path.is_file():
            raise RuntimeError("Không tìm thấy ảnh gốc")
        boxes = [
            tuple(float(row[key]) for key in ("source_x", "source_y", "source_width", "source_height"))
            for row in rows
        ]
        block_metadata = [dict(row) for row in rows]
        with Image.open(original_path) as image:
            rgb_image = np.asarray(image.convert("RGB"))
        if boxes:
            cleaned, mask, engine = inpaint_text_regions_hybrid(
                rgb_image, boxes, block_metadata
            )
        else:
            # Preserved SFX stays on the original artwork. Keep a deterministic
            # clean snapshot so export and Study do not reuse an older damaged
            # inpainting result.
            cleaned = rgb_image.copy()
            mask = np.zeros(rgb_image.shape[:2], dtype=np.uint8)
            engine = "preserve"
        if boxes and not np.any(mask):
            raise RuntimeError("Không tạo được mask chữ; ảnh sạch chưa được thay đổi")

        destination.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(cleaned).save(destination, format="PNG", optimize=True)
        preview = rgb_image.astype(np.float32).copy()
        preview[mask > 0] = preview[mask > 0] * 0.45 + np.array([255, 35, 35]) * 0.55
        preview_destination.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.clip(preview, 0, 255).astype(np.uint8)).save(
            preview_destination, format="PNG", optimize=True
        )
        now = utc_now()
        with db_session() as connection:
            connection.execute(
                """
                UPDATE pages
                SET clean_image_path = ?, mask_preview_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (relative_path, preview_relative_path, now, page_id),
            )
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'completed', progress = 1, result_count = ?,
                    current_step = ?, updated_at = ?
                WHERE id = ?
                """,
                (len(boxes), f"Xóa chữ · {engine}", now, job_id),
            )
    except Exception as exc:
        destination.unlink(missing_ok=True)
        preview_destination.unlink(missing_ok=True)
        message = str(exc).strip() or exc.__class__.__name__
        with db_session() as connection:
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'failed', error_message = ?, updated_at = ?
                WHERE id = ?
                """,
                (message[:1000], utc_now(), job_id),
            )
