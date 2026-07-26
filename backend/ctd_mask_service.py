from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
import torch

from app.config import (
    CTD_DEVICE,
    CTD_ENABLED,
    CTD_INPUT_SIZE,
    CTD_MULTI_SCALES,
    CTD_MODEL_PATH,
    CTD_VENDOR_PATH,
)


_detector = None
_model_lock = Lock()


def ctd_available() -> bool:
    return (
        CTD_ENABLED
        and CTD_MODEL_PATH.is_file()
        and (CTD_VENDOR_PATH / "inference.py").is_file()
    )


def _install_legacy_runtime_compatibility() -> None:
    """Keep the upstream 2023 inference code working on NumPy 2/PyTorch 2."""
    aliases = {
        "bool8": np.bool_,
        "float_": np.float64,
        "uint": np.uint64,
        "ScalarType": np.generic,
    }
    for name, value in aliases.items():
        if not hasattr(np, name):
            setattr(np, name, value)

    # These packages are training-only imports in the upstream repository.
    # Inference never calls them, so avoid adding two large runtime dependencies.
    if "wandb" not in sys.modules:
        wandb = types.ModuleType("wandb")
        wandb.init = lambda *args, **kwargs: None
        sys.modules["wandb"] = wandb
    if "torchsummary" not in sys.modules:
        torchsummary = types.ModuleType("torchsummary")
        torchsummary.summary = lambda *args, **kwargs: None
        sys.modules["torchsummary"] = torchsummary


def _load_detector():
    global _detector
    if _detector is not None:
        return _detector
    with _model_lock:
        if _detector is not None:
            return _detector
        if not ctd_available():
            raise RuntimeError("comic-text-detector chưa được cài")

        _install_legacy_runtime_compatibility()
        vendor = str(CTD_VENDOR_PATH.resolve())
        if vendor not in sys.path:
            sys.path.insert(0, vendor)

        inference = importlib.import_module("inference")
        device = CTD_DEVICE
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cuda" and not torch.cuda.is_available():
            device = "cpu"

        # torch.load defaults changed after this upstream checkpoint was made.
        original_load = torch.load

        def compatible_load(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return original_load(*args, **kwargs)

        try:
            torch.load = compatible_load
            _detector = inference.TextDetector(
                model_path=str(CTD_MODEL_PATH),
                input_size=CTD_INPUT_SIZE,
                device=device,
                act="leaky",
            )
        finally:
            torch.load = original_load
        return _detector


def _region_mask(
    shape: tuple[int, int],
    boxes: list[tuple[float, float, float, float]],
) -> np.ndarray:
    height, width = shape
    allowed = np.zeros((height, width), dtype=np.uint8)
    for x, y, box_width, box_height in boxes:
        pad_x = max(2, round(box_width * 0.04))
        pad_y = max(2, round(box_height * 0.04))
        left = max(0, int(np.floor(x)) - pad_x)
        top = max(0, int(np.floor(y)) - pad_y)
        right = min(width, int(np.ceil(x + box_width)) + pad_x)
        bottom = min(height, int(np.ceil(y + box_height)) + pad_y)
        if right > left and bottom > top:
            allowed[top:bottom, left:right] = 255
    return allowed


def _fill_long_sfx_gaps(
    refined: np.ndarray,
    raw: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    gray: np.ndarray,
) -> np.ndarray:
    """Use raw CTD segmentation only in empty slices of long display text."""
    completed = refined.copy()
    image_height, image_width = refined.shape
    for x, y, width, height in boxes:
        aspect = max(width / max(1.0, height), height / max(1.0, width))
        if aspect < 1.7:
            continue
        segments = max(4, min(7, round(aspect * 2)))
        vertical = height >= width
        for index in range(segments):
            if vertical:
                left = max(0, int(np.floor(x)))
                right = min(image_width, int(np.ceil(x + width)))
                top = max(0, int(np.floor(y + height * index / segments)))
                bottom = min(image_height, int(np.ceil(y + height * (index + 1) / segments)))
            else:
                left = max(0, int(np.floor(x + width * index / segments)))
                right = min(image_width, int(np.ceil(x + width * (index + 1) / segments)))
                top = max(0, int(np.floor(y)))
                bottom = min(image_height, int(np.ceil(y + height)))
            if right <= left or bottom <= top:
                continue
            current = completed[top:bottom, left:right]
            raw_slice = raw[top:bottom, left:right]
            refined_coverage = float(np.mean(current > 0))
            raw_coverage = float(np.mean(raw_slice > 0))
            # A partial outline can make the slice non-empty while most of a
            # giant glyph is still absent. Compare refined/raw coverage rather
            # than treating any pixel as success.
            sufficiently_refined = (
                refined_coverage >= 0.008
                and (raw_coverage < 0.03 or refined_coverage / raw_coverage >= 0.30)
            )
            if not sufficiently_refined and np.any(raw_slice):
                # Raw CTD is deliberately broad. Recover the dark body of an
                # outlined glyph inside it, then grow a few pixels to include
                # the decorative white/black rim without masking the full crop.
                dark = np.where(gray[top:bottom, left:right] <= 105, 255, 0).astype(np.uint8)
                detail = cv2.bitwise_and(raw_slice, dark)
                detail = cv2.morphologyEx(
                    detail,
                    cv2.MORPH_CLOSE,
                    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                )
                detail = cv2.dilate(
                    detail,
                    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
                    iterations=5,
                )
                completed[top:bottom, left:right] = cv2.bitwise_or(current, detail)
    return completed


def _dominant_component_ratio(mask: np.ndarray) -> float:
    if not np.any(mask):
        return 0.0
    count, _, stats, _ = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8), connectivity=8
    )
    if count <= 1:
        return 0.0
    areas = stats[1:, cv2.CC_STAT_AREA]
    return float(np.max(areas) / max(1, np.sum(areas)))


def _recover_aligned_glyph_components(
    refined: np.ndarray,
    gray: np.ndarray,
    box: tuple[float, float, float, float],
) -> np.ndarray:
    """Grow CTD seeds into aligned dark glyph bodies, not the raw text slab.

    Outlined display glyphs are normally isolated from manga artwork by their
    light rim. Threshold components recover the black body while alignment of
    consecutive glyphs rejects nearby speed lines and character shading.
    """
    image_height, image_width = refined.shape
    x, y, width, height = box
    left = max(0, int(np.floor(x)))
    top = max(0, int(np.floor(y)))
    right = min(image_width, int(np.ceil(x + width)))
    bottom = min(image_height, int(np.ceil(y + height)))
    if right <= left or bottom <= top:
        return refined.copy()
    crop_width = right - left
    crop_height = bottom - top
    crop_area = max(1, crop_width * crop_height)
    dark = (gray[top:bottom, left:right] <= 90).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    seed = refined[top:bottom, left:right] > 0
    candidates: list[dict] = []
    for component_id in range(1, count):
        component_x, component_y, component_width, component_height, area = (
            int(value) for value in stats[component_id]
        )
        if area < max(64, round(crop_area * 0.015)):
            continue
        if component_width < crop_width * 0.42 or component_height < crop_height * 0.08:
            continue
        component = labels == component_id
        overlap = int(np.count_nonzero(seed & component))
        candidates.append({
            "id": component_id,
            "area": area,
            "width": component_width,
            "center_x": component_x + component_width / 2,
            "overlap": overlap,
        })
    anchors = [
        item for item in candidates
        if item["width"] >= crop_width * 0.45
        and item["overlap"] >= max(12, round(item["area"] * 0.01))
    ]
    # A single seed may be an illustration edge. Requiring two aligned glyphs
    # keeps this recovery exclusive to genuine multi-character display text.
    if len(anchors) < 2:
        return refined.copy()
    anchor_center = float(np.median([item["center_x"] for item in anchors]))
    selected_ids = {
        item["id"] for item in candidates
        if item["width"] >= crop_width * 0.45
        and abs(item["center_x"] - anchor_center) <= crop_width * 0.16
    }
    recovered = refined.copy()
    recovered_crop = recovered[top:bottom, left:right]
    for component_id in selected_ids:
        recovered_crop[labels == component_id] = 255
    recovered[top:bottom, left:right] = recovered_crop
    return recovered


def _stabilize_long_sfx_mask(
    refined: np.ndarray,
    gap_filled: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
    gray: np.ndarray,
) -> np.ndarray:
    """Replace only pathological raw-mask explosions with glyph components."""
    stable = gap_filled.copy()
    image_height, image_width = refined.shape
    for box in boxes:
        x, y, width, height = box
        left = max(0, int(np.floor(x)))
        top = max(0, int(np.floor(y)))
        right = min(image_width, int(np.ceil(x + width)))
        bottom = min(image_height, int(np.ceil(y + height)))
        if right <= left or bottom <= top:
            continue
        before = refined[top:bottom, left:right]
        after = gap_filled[top:bottom, left:right]
        refined_coverage = float(np.mean(before > 0))
        filled_coverage = float(np.mean(after > 0))
        exploded = (
            refined_coverage <= 0.25
            and filled_coverage >= 0.55
            and filled_coverage / max(0.005, refined_coverage) >= 3.0
            and _dominant_component_ratio(after) >= 0.85
        )
        if not exploded:
            continue
        recovered = _recover_aligned_glyph_components(refined, gray, box)
        stable[top:bottom, left:right] = recovered[top:bottom, left:right]
    return stable


def create_ctd_text_mask(
    rgb_image: np.ndarray,
    boxes: list[tuple[float, float, float, float]],
) -> np.ndarray:
    """Segment glyph strokes with comic-text-detector and keep requested blocks only."""
    if rgb_image.ndim != 3 or rgb_image.shape[2] != 3:
        raise ValueError("comic-text-detector cần ảnh RGB")
    if not boxes:
        return np.zeros(rgb_image.shape[:2], dtype=np.uint8)

    detector = _load_detector()
    bgr_image = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
    image_height, image_width = rgb_image.shape[:2]
    image_area = max(1, image_height * image_width)
    needs_multiscale = any(
        max(width / max(1.0, height), height / max(1.0, width)) >= 1.7
        or (width * height) / image_area >= 0.06
        for _, _, width, height in boxes
    )
    sizes = CTD_MULTI_SCALES if needs_multiscale else (CTD_INPUT_SIZE,)
    sizes = tuple(dict.fromkeys(size for size in sizes if size >= 320)) or (CTD_INPUT_SIZE,)
    combined = np.zeros((image_height, image_width), dtype=np.uint8)
    raw_combined = np.zeros((image_height, image_width), dtype=np.uint8)
    with _model_lock, torch.inference_mode():
        original_size = detector.input_size
        try:
            for size in sizes:
                detector.input_size = (size, size)
                raw, refined, _ = detector(
                    bgr_image,
                    refine_mode=1,  # upstream REFINEMASK_INPAINT
                    keep_undetected_mask=True,
                )
                current = np.where(np.asarray(refined) > 0, 255, 0).astype(np.uint8)
                raw_current = np.where(np.asarray(raw) > 0, 255, 0).astype(np.uint8)
                combined = cv2.bitwise_or(combined, current)
                raw_combined = cv2.bitwise_or(raw_combined, raw_current)
        finally:
            detector.input_size = original_size
    allowed = _region_mask(combined.shape, boxes)
    mask = cv2.bitwise_and(combined, allowed)
    raw_mask = cv2.bitwise_and(raw_combined, allowed)
    gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)
    refined_mask = mask.copy()
    mask = _fill_long_sfx_gaps(mask, raw_mask, boxes, gray)
    mask = _stabilize_long_sfx_mask(refined_mask, mask, boxes, gray)

    # One pixel around the learned glyph mask removes anti-aliased Japanese
    # outlines without expanding into the broad rectangular OCR region.
    if np.any(mask):
        mask = cv2.dilate(
            mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
            iterations=1,
        )
        mask = cv2.bitwise_and(mask, _region_mask(mask.shape, boxes))
    return mask


def reset_ctd_model_for_tests() -> None:
    global _detector
    with _model_lock:
        _detector = None
