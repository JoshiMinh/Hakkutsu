from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageStat


FONT_PATHS = {
    "arial": Path("C:/Windows/Fonts/arial.ttf"),
    "tahoma": Path("C:/Windows/Fonts/tahoma.ttf"),
    "times new roman": Path("C:/Windows/Fonts/times.ttf"),
    "comic sans ms": Path("C:/Windows/Fonts/comic.ttf"),
}

# Speech bubbles are rarely perfect rectangles. Keeping lettering inside this
# central safe area avoids curved and pointed bubble edges.
SAFE_WIDTH_RATIO = 0.78
SAFE_HEIGHT_RATIO = 0.82


@dataclass(frozen=True)
class TextLayout:
    font_size: int
    lines: tuple[str, ...]
    width: int
    height: int
    spacing: int


def get_font(font_family: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONT_PATHS.get(font_family.strip().lower(), FONT_PATHS["arial"])
    if not path.is_file():
        path = FONT_PATHS["arial"]
    return ImageFont.truetype(str(path), size=size)


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> tuple[str, ...]:
    def split_word(word: str) -> list[str]:
        """Split an oversized token so it can never escape the box."""
        pieces: list[str] = []
        current = ""
        for character in word:
            candidate = current + character
            if current and font.getlength(candidate) > max_width:
                pieces.append(current)
                current = character
            else:
                current = candidate
        if current:
            pieces.append(current)
        return pieces or [word]

    lines: list[str] = []
    paragraphs = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    for paragraph in paragraphs:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        expanded_words = [piece for word in words for piece in split_word(word)]
        current = expanded_words[0]
        for word in expanded_words[1:]:
            candidate = f"{current} {word}"
            if font.getlength(candidate) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return tuple(lines)


def layout_at_size(text: str, width: float, size: int, font_family: str) -> TextLayout:
    font = get_font(font_family, size)
    max_width = max(1, int(width * SAFE_WIDTH_RATIO))
    lines = wrap_text(text, font, max_width)
    spacing = max(1, round(size * 0.16))
    sample_box = font.getbbox("Ágj")
    line_height = sample_box[3] - sample_box[1]
    text_width = max((round(font.getlength(line)) for line in lines), default=0)
    text_height = line_height * len(lines) + spacing * max(0, len(lines) - 1)
    return TextLayout(size, lines, text_width, text_height, spacing)


def fit_text_layout(
    text: str,
    width: float,
    height: float,
    font_family: str = "Arial",
    minimum_size: int = 6,
    maximum_size: int = 160,
) -> TextLayout:
    usable_width = max(1, int(width * SAFE_WIDTH_RATIO))
    usable_height = max(1, int(height * SAFE_HEIGHT_RATIO))
    low = minimum_size
    high = max(minimum_size, min(maximum_size, int(height)))
    best = layout_at_size(text, width, minimum_size, font_family)
    while low <= high:
        middle = (low + high) // 2
        candidate = layout_at_size(text, width, middle, font_family)
        if candidate.width <= usable_width and candidate.height <= usable_height:
            best = candidate
            low = middle + 1
        else:
            high = middle - 1
    return best


def suggest_font_size(text: str, width: float, height: float, font_family: str = "Arial") -> int:
    return fit_text_layout(text, width, height, font_family).font_size


def _background_collision_score(image: Image.Image, box: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = box
    left = max(0, min(image.width, left))
    top = max(0, min(image.height, top))
    right = max(left + 1, min(image.width, right))
    bottom = max(top + 1, min(image.height, bottom))
    crop = image.crop((left, top, right, bottom)).convert("L")
    # Clean bubbles may be white or black. Character art is identified by the
    # strong mixture of tones instead of absolute brightness.
    return float(ImageStat.Stat(crop).stddev[0]) / 128.0


def _nearby_border_penalty(
    gray: np.ndarray,
    box: tuple[float, float, float, float],
    clearance: int,
) -> float:
    """Penalize text that is visually crowded against a panel/bubble line."""
    left, top, right, bottom = (round(value) for value in box)
    image_height, image_width = gray.shape
    strongest_penalty = 0.0

    strips = (
        (max(0, left - clearance), top, left, bottom, "vertical", True),
        (right, top, min(image_width, right + clearance), bottom, "vertical", False),
        (left, max(0, top - clearance), right, top, "horizontal", True),
        (left, bottom, right, min(image_height, bottom + clearance), "horizontal", False),
    )
    for strip_left, strip_top, strip_right, strip_bottom, direction, reverse in strips:
        if strip_right <= strip_left or strip_bottom <= strip_top:
            strongest_penalty = max(strongest_penalty, 0.3)
            continue
        strip = gray[strip_top:strip_bottom, strip_left:strip_right]
        darkness = strip < 105
        line_strength = darkness.mean(axis=0 if direction == "vertical" else 1)
        indices = np.flatnonzero(line_strength >= 0.55)
        if not len(indices):
            continue
        distance = (len(line_strength) - 1 - indices[-1]) if reverse else indices[0]
        proximity = max(0.0, 1.0 - distance / max(1, clearance))
        strongest_penalty = max(strongest_penalty, proximity * 0.28)
    return strongest_penalty


def _visual_clearance_penalty(
    ink: np.ndarray,
    box: tuple[float, float, float, float],
    font_size: int,
) -> float:
    """Score optical balance against the nearest ink in four directions."""
    image_height, image_width = ink.shape
    left, top, right, bottom = (round(value) for value in box)
    left = max(0, min(image_width, left))
    right = max(left + 1, min(image_width, right))
    top = max(0, min(image_height, top))
    bottom = max(top + 1, min(image_height, bottom))
    search = max(20, round(font_size * 3.0))
    def nearest_vertical(start: int, end: int, reverse: bool) -> float:
        if end <= start:
            return 0.0
        strip = ink[top:bottom, start:end]
        strength = strip.mean(axis=0)
        hits = np.flatnonzero(strength >= 0.035)
        if not len(hits):
            return float(end - start)
        return float((end - start - hits[-1]) if reverse else (hits[0] + 1))

    def nearest_horizontal(start: int, end: int, reverse: bool) -> float:
        if end <= start:
            return 0.0
        strip = ink[start:end, left:right]
        strength = strip.mean(axis=1)
        hits = np.flatnonzero(strength >= 0.035)
        if not len(hits):
            return float(end - start)
        return float((end - start - hits[-1]) if reverse else (hits[0] + 1))

    clear_left = nearest_vertical(max(0, left - search), left, True)
    clear_right = nearest_vertical(right, min(image_width, right + search), False)
    clear_top = nearest_horizontal(max(0, top - search), top, True)
    clear_bottom = nearest_horizontal(bottom, min(image_height, bottom + search), False)

    softness = max(4.0, font_size * 0.25)
    horizontal_balance = abs(np.log((clear_left + softness) / (clear_right + softness)))
    vertical_balance = abs(np.log((clear_top + softness) / (clear_bottom + softness)))
    ideal_clearance = max(8.0, font_size * 0.65)
    tight_sides = sum(
        max(0.0, ideal_clearance - value) / ideal_clearance
        for value in (clear_left, clear_right, clear_top, clear_bottom)
    )
    return float(horizontal_balance * 0.055 + vertical_balance * 0.045 + tight_sides * 0.05)


def _crosses_strong_ink_barrier(
    ink: np.ndarray,
    box: tuple[float, float, float, float],
) -> bool:
    """Reject candidates crossing a panel edge or speech-bubble boundary."""
    image_height, image_width = ink.shape
    left, top, right, bottom = (round(value) for value in box)
    left = max(0, min(image_width, left))
    right = max(left + 1, min(image_width, right))
    top = max(0, min(image_height, top))
    bottom = max(top + 1, min(image_height, bottom))
    crop = ink[top:bottom, left:right]
    if not crop.size:
        return True
    return bool(np.any(crop.mean(axis=0) >= 0.62) or np.any(crop.mean(axis=1) >= 0.62))


def _nearby_container_bounds(
    ink: np.ndarray,
    anchor_x: float,
    anchor_y: float,
    width: float,
    height: float,
) -> tuple[float | None, float | None, float | None, float | None]:
    """Find nearby long panel/container edges even when a bubble hides a segment."""
    image_height, image_width = ink.shape
    center_x = round(anchor_x + width / 2)
    center_y = round(anchor_y + height / 2)
    vertical_radius = max(100, round(height * 1.6))
    horizontal_radius = max(100, round(width * 1.6))
    y1, y2 = max(0, center_y - vertical_radius), min(image_height, center_y + vertical_radius)
    x1, x2 = max(0, center_x - horizontal_radius), min(image_width, center_x + horizontal_radius)
    vertical_strength = ink[y1:y2, :].mean(axis=0)
    horizontal_strength = ink[:, x1:x2].mean(axis=1)
    vertical_hits = np.flatnonzero(vertical_strength >= 0.48)
    horizontal_hits = np.flatnonzero(horizontal_strength >= 0.48)
    maximum_x_distance = max(160, round(width * 2.6))
    maximum_y_distance = max(140, round(height * 2.2))

    left_hits = vertical_hits[vertical_hits < center_x]
    right_hits = vertical_hits[vertical_hits > center_x]
    top_hits = horizontal_hits[horizontal_hits < center_y]
    bottom_hits = horizontal_hits[horizontal_hits > center_y]
    left = float(left_hits[-1]) if len(left_hits) and center_x - left_hits[-1] <= maximum_x_distance else None
    right = float(right_hits[0]) if len(right_hits) and right_hits[0] - center_x <= maximum_x_distance else None
    top = float(top_hits[-1]) if len(top_hits) and center_y - top_hits[-1] <= maximum_y_distance else None
    bottom = float(bottom_hits[0]) if len(bottom_hits) and bottom_hits[0] - center_y <= maximum_y_distance else None
    return left, top, right, bottom


def fit_text_away_from_art(
    image: Image.Image,
    text: str,
    x: float,
    y: float,
    width: float,
    height: float,
    font_family: str = "Arial",
    text_align: str = "center",
) -> tuple[TextLayout, float, float]:
    """Fit text, then move it vertically toward the cleanest part of its box."""
    initial = fit_text_layout(text, width, height, font_family)
    minimum_readable = max(10, round(initial.font_size * 0.72))
    best: tuple[float, int, TextLayout, float] | None = None

    for size in range(initial.font_size, minimum_readable - 1, -1):
        layout = layout_at_size(text, width, size, font_family)
        safe_top = y + height * (1 - SAFE_HEIGHT_RATIO) / 2
        safe_bottom = y + height - height * (1 - SAFE_HEIGHT_RATIO) / 2
        half_text_height = layout.height / 2
        first_center = safe_top + half_text_height
        last_center = safe_bottom - half_text_height
        natural_center = y + height / 2
        if first_center > last_center:
            centers = [natural_center]
        else:
            step = max(1, round(height / 36))
            centers = [
                first_center + index * step
                for index in range(int((last_center - first_center) / step) + 1)
            ]
            centers.extend([last_center, natural_center])

        horizontal_padding = width * (1 - SAFE_WIDTH_RATIO) / 2
        if text_align == "left":
            text_left = x + horizontal_padding
        elif text_align == "right":
            text_left = x + width - horizontal_padding - layout.width
        else:
            text_left = x + (width - layout.width) / 2

        size_best: tuple[float, float] | None = None
        margin = max(2, round(size * 0.08))
        for center in centers:
            box = (
                round(text_left - margin),
                round(center - half_text_height - margin),
                round(text_left + layout.width + margin),
                round(center + half_text_height + margin),
            )
            raw_score = _background_collision_score(image, box)
            offset = center - natural_center
            score = raw_score + abs(offset) / max(1, height) * 0.012
            if size_best is None or score < size_best[0]:
                size_best = (score, offset)

        assert size_best is not None
        raw_best = size_best[0] - abs(size_best[1]) / max(1, height) * 0.012
        candidate = (raw_best, -size, layout, size_best[1])
        if best is None or candidate[:2] < best[:2]:
            best = candidate
        # Move full-sized text first; shrink only when every available slot
        # still contains a meaningful amount of character/detail.
        if raw_best <= 0.18:
            return layout, size_best[1], raw_best

    assert best is not None
    return best[2], best[3], best[0]


def place_text_in_clear_area(
    image: Image.Image,
    text: str,
    anchor_x: float,
    anchor_y: float,
    width: float,
    height: float,
    font_family: str = "Arial",
    text_align: str = "center",
    occupied_boxes: tuple[tuple[float, float, float, float], ...] = (),
    occupied_clearance: float = 0,
    container_bounds: tuple[float, float, float, float] | None = None,
) -> tuple[TextLayout, float, float, float]:
    """Move the whole layout box to nearby whitespace, preferring space above."""
    initial = fit_text_layout(text, width, height, font_family)
    gray_image = np.asarray(image.convert("L"))
    ink_image = gray_image < 125
    container_left, container_top, container_right, container_bottom = _nearby_container_bounds(
        ink_image, anchor_x, anchor_y, width, height
    )
    if container_bounds is not None:
        bound_left, bound_top, bound_right, bound_bottom = container_bounds
        container_left = max(container_left, bound_left) if container_left is not None else bound_left
        container_top = max(container_top, bound_top) if container_top is not None else bound_top
        container_right = min(container_right, bound_right) if container_right is not None else bound_right
        container_bottom = min(container_bottom, bound_bottom) if container_bottom is not None else bound_bottom
    minimum_readable = max(10, round(initial.font_size * 0.72))
    x_shifts = tuple(step / 10 for step in range(-6, 7))
    y_shifts = tuple(step / 10 for step in range(-10, 5))
    best: tuple[float, int, TextLayout, float, float, float, float] | None = None

    for size in range(initial.font_size, minimum_readable - 1, -1):
        layout = layout_at_size(text, width, size, font_family)
        margin = max(2, round(size * 0.1))
        for y_factor in y_shifts:
            for x_factor in x_shifts:
                candidate_x = anchor_x + x_factor * width
                candidate_y = anchor_y + y_factor * height
                if (
                    candidate_x < 0 or candidate_y < 0
                    or candidate_x + width > image.width
                    or candidate_y + height > image.height
                ):
                    continue

                horizontal_padding = width * (1 - SAFE_WIDTH_RATIO) / 2
                if text_align == "left":
                    text_left = candidate_x + horizontal_padding
                elif text_align == "right":
                    text_left = candidate_x + width - horizontal_padding - layout.width
                else:
                    text_left = candidate_x + (width - layout.width) / 2
                text_top = candidate_y + (height - layout.height) / 2
                text_box = (
                    text_left - margin,
                    text_top - margin,
                    text_left + layout.width + margin,
                    text_top + layout.height + margin,
                )
                container_margin = max(3, round(size * 0.18))
                if (
                    (container_left is not None and text_box[0] < container_left + container_margin)
                    or (container_right is not None and text_box[2] > container_right - container_margin)
                    or (container_top is not None and text_box[1] < container_top + container_margin)
                    or (container_bottom is not None and text_box[3] > container_bottom - container_margin)
                ):
                    continue

                text_area = max(1.0, (text_box[2] - text_box[0]) * (text_box[3] - text_box[1]))
                overlaps_another = False
                for other_x, other_y, other_width, other_height in occupied_boxes:
                    other_left = other_x - occupied_clearance
                    other_top = other_y - occupied_clearance
                    other_right = other_x + other_width + occupied_clearance
                    other_bottom = other_y + other_height + occupied_clearance
                    overlap_width = max(0.0, min(text_box[2], other_right) - max(text_box[0], other_left))
                    overlap_height = max(0.0, min(text_box[3], other_bottom) - max(text_box[1], other_top))
                    if (
                        occupied_clearance > 0 and overlap_width > 0 and overlap_height > 0
                    ) or overlap_width * overlap_height / text_area > 0.08:
                        overlaps_another = True
                        break
                if overlaps_another:
                    continue
                if _crosses_strong_ink_barrier(ink_image, text_box):
                    continue

                raw_score = _background_collision_score(image, tuple(round(value) for value in text_box))
                border_penalty = _nearby_border_penalty(
                    gray_image, text_box, max(8, round(size * 0.8))
                )
                visual_penalty = _visual_clearance_penalty(
                    ink_image, text_box, size
                )
                movement = abs(x_factor) + abs(y_factor)
                # A downward move is visually less natural for vertical Japanese
                # dialogue, so use it only when no clear upper slot exists.
                aesthetic_score = (
                    raw_score * 0.6 + border_penalty + visual_penalty
                    + movement * 0.005 + max(0.0, y_factor) * 0.012
                )
                candidate = (
                    aesthetic_score, -size, layout, candidate_x, candidate_y,
                    raw_score, border_penalty,
                )
                if best is None or candidate[:2] < best[:2]:
                    best = candidate

                if raw_score <= 0.075 and border_penalty <= 0.04:
                    # Search all positions at this font size, then choose the
                    # cleanest/aesthetically closest one before considering shrink.
                    continue

        if (
            best is not None and best[2].font_size == size
            and best[5] <= 0.075 and best[6] <= 0.04
        ):
            return best[2], best[3], best[4], best[5]

    if best is None:
        return initial, anchor_x, anchor_y, 1.0
    return best[2], best[3], best[4], best[5]


def text_layout_bounds(
    layout: TextLayout,
    x: float,
    y: float,
    width: float,
    height: float,
    text_align: str = "center",
) -> tuple[float, float, float, float]:
    """Return the visible text rectangle, rather than its larger editor box."""
    horizontal_padding = width * (1 - SAFE_WIDTH_RATIO) / 2
    if text_align == "left":
        text_left = x + horizontal_padding
    elif text_align == "right":
        text_left = x + width - horizontal_padding - layout.width
    else:
        text_left = x + (width - layout.width) / 2
    text_top = y + (height - layout.height) / 2
    margin = max(2, round(layout.font_size * 0.1))
    return (
        text_left - margin,
        text_top - margin,
        layout.width + margin * 2,
        layout.height + margin * 2,
    )


def pack_grouped_text_fallback(
    text: str,
    anchor_x: float,
    anchor_y: float,
    width: float,
    height: float,
    occupied_boxes: tuple[tuple[float, float, float, float], ...],
    clearance: float,
    container_bounds: tuple[float, float, float, float],
    font_family: str = "Arial",
    text_align: str = "center",
) -> tuple[TextLayout, float, float]:
    """Deterministically pack a grouped dialogue when visual search has no candidate."""
    initial = fit_text_layout(text, width, height, font_family)
    container_left, container_top, container_right, container_bottom = container_bounds
    edge_margin = max(4.0, min(width, height) * 0.04)
    minimum_size = max(10, round(initial.font_size * 0.58))

    for size in range(initial.font_size, minimum_size - 1, -1):
        layout = layout_at_size(text, width, size, font_family)
        placed_x = anchor_x
        placed_y = anchor_y
        for _ in range(3):
            box = text_layout_bounds(layout, placed_x, placed_y, width, height, text_align)
            box_left, box_top, box_width, box_height = box
            box_right = box_left + box_width
            box_bottom = box_top + box_height

            if box_left < container_left + edge_margin:
                placed_x += container_left + edge_margin - box_left
            if box_right > container_right - edge_margin:
                placed_x -= box_right - (container_right - edge_margin)
            if box_top < container_top + edge_margin:
                placed_y += container_top + edge_margin - box_top
            if box_bottom > container_bottom - edge_margin:
                placed_y -= box_bottom - (container_bottom - edge_margin)

            box = text_layout_bounds(layout, placed_x, placed_y, width, height, text_align)
            box_left, box_top, box_width, box_height = box
            box_right = box_left + box_width
            box_bottom = box_top + box_height
            for other_x, other_y, other_width, other_height in occupied_boxes:
                other_right = other_x + other_width
                other_bottom = other_y + other_height
                vertical_overlap = min(box_bottom, other_bottom) - max(box_top, other_y)
                if vertical_overlap <= 0:
                    continue
                current_center = box_left + box_width / 2
                other_center = other_x + other_width / 2
                if current_center <= other_center:
                    placed_x -= max(0.0, box_right - (other_x - clearance))
                else:
                    placed_x += max(0.0, other_right + clearance - box_left)

        final_box = text_layout_bounds(layout, placed_x, placed_y, width, height, text_align)
        final_left, final_top, final_width, final_height = final_box
        final_right = final_left + final_width
        final_bottom = final_top + final_height
        inside = (
            final_left >= container_left + edge_margin - 0.5
            and final_right <= container_right - edge_margin + 0.5
            and final_top >= container_top + edge_margin - 0.5
            and final_bottom <= container_bottom - edge_margin + 0.5
        )
        separated = True
        for other_x, other_y, other_width, other_height in occupied_boxes:
            overlap_width = min(final_right, other_x + other_width + clearance) - max(
                final_left, other_x - clearance
            )
            overlap_height = min(final_bottom, other_y + other_height + clearance) - max(
                final_top, other_y - clearance
            )
            if overlap_width > 0 and overlap_height > 0:
                separated = False
                break
        if inside and separated:
            return layout, placed_x, placed_y

    return layout, placed_x, placed_y


def suggest_text_color(
    image: Image.Image, x: float, y: float, width: float, height: float
) -> str:
    left = max(0, round(x))
    top = max(0, round(y))
    right = min(image.width, round(x + width))
    bottom = min(image.height, round(y + height))
    if right <= left or bottom <= top:
        return "#000000"
    luminance = image.convert("L").crop((left, top, right, bottom))
    median = float(ImageStat.Stat(luminance).median[0])
    return "#ffffff" if median < 145 else "#000000"


def suppress_overlapping_blocks(blocks: list[Mapping]) -> list[Mapping]:
    """Keep the larger of near-duplicate OCR boxes during rendering."""
    kept: list[Mapping] = []
    ordered = sorted(
        blocks,
        key=lambda block: float(block["width"]) * float(block["height"]),
        reverse=True,
    )
    for candidate in ordered:
        candidate_area = float(candidate["width"]) * float(candidate["height"])
        duplicate = False
        for existing in kept:
            intersection_width = max(
                0.0,
                min(float(candidate["x"]) + float(candidate["width"]), float(existing["x"]) + float(existing["width"]))
                - max(float(candidate["x"]), float(existing["x"])),
            )
            intersection_height = max(
                0.0,
                min(float(candidate["y"]) + float(candidate["height"]), float(existing["y"]) + float(existing["height"]))
                - max(float(candidate["y"]), float(existing["y"])),
            )
            intersection = intersection_width * intersection_height
            existing_area = float(existing["width"]) * float(existing["height"])
            if intersection / max(1.0, min(candidate_area, existing_area)) >= 0.8:
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)
    return kept


def render_translated_page(image_path: Path, blocks: list[Mapping]) -> Image.Image:
    with Image.open(image_path) as source:
        canvas = source.convert("RGBA")

    for block in suppress_overlapping_blocks(blocks):
        text = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
        if not text:
            continue
        width = max(1, round(float(block["width"])))
        height = max(1, round(float(block["height"])))
        family = str(block.get("font_family") or "Arial")
        fitted = fit_text_layout(text, width, height, family)
        requested_size = max(6, round(float(block.get("font_size") or fitted.font_size)))
        actual_size = min(requested_size, fitted.font_size)
        layout = layout_at_size(text, width, actual_size, family)
        font = get_font(family, actual_size)

        layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        multiline = "\n".join(layout.lines)
        box = draw.multiline_textbbox(
            (0, 0), multiline, font=font, spacing=layout.spacing,
            align=str(block.get("text_align") or "center"),
        )
        text_width = box[2] - box[0]
        text_height = box[3] - box[1]
        alignment = str(block.get("text_align") or "center")
        padding = max(2, round(width * (1 - SAFE_WIDTH_RATIO) / 2))
        if alignment == "left":
            text_x = padding - box[0]
        elif alignment == "right":
            text_x = width - padding - text_width - box[0]
        else:
            text_x = (width - text_width) / 2 - box[0]
        text_y = (height - text_height) / 2 - box[1] + float(block.get("text_offset_y") or 0)
        draw.multiline_text(
            (text_x, text_y),
            multiline,
            font=font,
            fill=str(block.get("color") or "#000000"),
            spacing=layout.spacing,
            align=alignment,
        )

        rotation = float(block.get("rotation") or 0)
        if rotation:
            layer = layer.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)
        center_x = float(block["x"]) + float(block["width"]) / 2
        center_y = float(block["y"]) + float(block["height"]) / 2
        paste_x = round(center_x - layer.width / 2)
        paste_y = round(center_y - layer.height / 2)
        canvas.alpha_composite(layer, (paste_x, paste_y))

    return canvas.convert("RGB")
