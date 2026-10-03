import type { OcrFragment } from "./ocr-engine";

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export interface DetectedDialogueRegion {
  id: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  orientation: "vertical" | "horizontal";
  confidence?: number;
  type: "bubble" | "text-cluster";
}

export interface DialogueDetectionOptions {
  minBubbleArea?: number;
  maxBubbleAreaFraction?: number;
  includeBorderlessText?: boolean;
}

/**
 * Pre-OCR Speech Bubble & Text Area Detector for Manga.
 *
 * Employs a multi-cue computer vision pipeline:
 * 1. Speech Bubble Interior Contour Analysis: Connected components of light interiors
 *    bounded by dark ink, verified with character stroke transition density.
 * 2. Directional Text-Stroke Clustering: Vertical/horizontal morphological dilation
 *    to capture borderless dialogue, thoughts, and sound effects.
 * 3. Anti-False-Positive Filtering: Eliminates eyes, hair blocks, screentone patches,
 *    and panel gutter lines.
 * 4. Normalizes bounds with comfortable padding and sorts in standard Japanese
 *    manga reading order (top-to-bottom, right-to-left).
 */
export function detectMangaDialogueRegions(
  pixels: Pixels,
  options: DialogueDetectionOptions = {}
): DetectedDialogueRegion[] {
  if (!pixels || pixels.width < 30 || pixels.height < 30) return [];

  const {
    minBubbleArea = 100,
    maxBubbleAreaFraction = 0.40,
    includeBorderlessText = true,
  } = options;

  // Scale down high-res scans to standard analysis resolution (~1200-1400px max)
  const maxDim = Math.max(pixels.width, pixels.height);
  const scale = Math.max(1, maxDim / 1300);
  const width = Math.ceil(pixels.width / scale);
  const height = Math.ceil(pixels.height / scale);

  // 1. Build grayscale luminance buffer
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(pixels.height - 1, Math.floor(y * scale));
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(pixels.width - 1, Math.floor(x * scale));
      const p = (sy * pixels.width + sx) * 4;
      gray[rowOffset + x] = Math.round(
        pixels.data[p] * 0.299 + pixels.data[p + 1] * 0.587 + pixels.data[p + 2] * 0.114
      );
    }
  }

  type CandidateBox = {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    orientation: "vertical" | "horizontal";
    type: "bubble" | "text-cluster";
  };

  const rawCandidates: CandidateBox[] = [];

  // =========================================================================
  // Pass 1: Speech Bubble Connected Component Analysis with Morphological Closing
  // =========================================================================
  // 1. Build binary mask of white/light pixels (speech bubble interiors)
  const isWhite = new Uint8Array(width * height);
  for (let i = 0; i < isWhite.length; i++) {
    isWhite[i] = gray[i] >= 185 ? 1 : 0;
  }

  // Morphological Closing: Dilate by radius r=3, then erode by radius r=3.
  // This bridges dark character strokes (2-5px wide) inside speech bubbles so that
  // multi-line text does not cut the bubble into disjoint fragments.
  const r = 3;
  const dilH = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < width && isWhite[rowOffset + nx] === 1) {
          val = 1;
          break;
        }
      }
      dilH[rowOffset + x] = val;
    }
  }

  const dilV = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height && dilH[ny * width + x] === 1) {
          val = 1;
          break;
        }
      }
      dilV[y * width + x] = val;
    }
  }

  const eroH = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let val = 1;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width || dilV[rowOffset + nx] === 0) {
          val = 0;
          break;
        }
      }
      eroH[rowOffset + x] = val;
    }
  }

  const closed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 1;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height || eroH[ny * width + x] === 0) {
          val = 0;
          break;
        }
      }
      closed[y * width + x] = val;
    }
  }

  const bubbleLabels = new Int32Array(width * height);
  for (let i = 0; i < bubbleLabels.length; i++) {
    bubbleLabels[i] = closed[i] === 1 ? 0 : -1;
  }

  const queue = new Int32Array(width * height);
  let bubbleId = 0;

  for (let seed = 0; seed < bubbleLabels.length; seed++) {
    if (bubbleLabels[seed] !== 0) continue;
    bubbleId++;
    let head = 0;
    let tail = 1;
    let edgeTouch = false;
    let bx0 = width, by0 = height, bx1 = 0, by1 = 0;
    queue[0] = seed;
    bubbleLabels[seed] = bubbleId;

    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = Math.floor(p / width);
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (x > bx1) bx1 = x;
      if (y > by1) by1 = y;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edgeTouch = true;
      }

      // 4-way BFS
      if (x > 0 && bubbleLabels[p - 1] === 0) {
        bubbleLabels[p - 1] = bubbleId;
        queue[tail++] = p - 1;
      }
      if (x + 1 < width && bubbleLabels[p + 1] === 0) {
        bubbleLabels[p + 1] = bubbleId;
        queue[tail++] = p + 1;
      }
      if (y > 0 && bubbleLabels[p - width] === 0) {
        bubbleLabels[p - width] = bubbleId;
        queue[tail++] = p - width;
      }
      if (y + 1 < height && bubbleLabels[p + width] === 0) {
        bubbleLabels[p + width] = bubbleId;
        queue[tail++] = p + width;
      }
    }

    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const bArea = bw * bh;

    // Discard huge outer margins touching outer borders
    if (edgeTouch && tail > width * height * 0.04) continue;
    if (tail < minBubbleArea) continue;
    if (tail > width * height * maxBubbleAreaFraction) continue;
    if (tail / bArea < 0.22) continue;
    const aspect = bh / bw;
    if (aspect < 0.2 || aspect > 5.0) continue;

    // Verify dark ink strokes and character edge transitions inside candidate bubble
    let darkCount = 0;
    let transitions = 0;
    let tx0 = bx1, ty0 = by1, tx1 = bx0, ty1 = by0;

    for (let y = by0; y <= by1; y++) {
      let prevDark = false;
      const rowOffset = y * width;
      for (let x = bx0; x <= bx1; x++) {
        const val = gray[rowOffset + x];
        const isDark = val <= 125;
        if (isDark) {
          darkCount++;
          if (x < tx0) tx0 = x;
          if (y < ty0) ty0 = y;
          if (x > tx1) tx1 = x;
          if (y > ty1) ty1 = y;
          if (!prevDark) transitions++;
        }
        prevDark = isDark;
      }
    }

    // A valid speech bubble must contain text ink strokes
    if (transitions >= 6 && darkCount >= 8 && tx1 >= tx0 && ty1 >= ty0) {
      const textW = tx1 - tx0 + 1;
      const textH = ty1 - ty0 + 1;

      // Expand dialogue bounds with comfortable padding bounded by bubble interior
      const padX = Math.max(8, Math.round(textW * 0.12));
      const padY = Math.max(8, Math.round(textH * 0.12));

      const cx0 = Math.max(bx0, tx0 - padX);
      const cy0 = Math.max(by0, ty0 - padY);
      const cx1 = Math.min(bx1, tx1 + padX);
      const cy1 = Math.min(by1, ty1 + padY);

      rawCandidates.push({
        x0: Math.max(0, Math.floor(cx0 * scale)),
        y0: Math.max(0, Math.floor(cy0 * scale)),
        x1: Math.min(pixels.width, Math.ceil((cx1 + 1) * scale)),
        y1: Math.min(pixels.height, Math.ceil((cy1 + 1) * scale)),
        orientation: (cy1 - cy0) >= (cx1 - cx0) * 0.85 ? "vertical" : "horizontal",
        type: "bubble",
      });
    }
  }

  // =========================================================================
  // Pass 2: High-Precision Floating Text-Stroke Clustering (for Borderless Text)
  // =========================================================================
  if (includeBorderlessText) {
    const strokeMask = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = rowOffset + x;
        const val = gray[idx];
        if (val <= 120) {
          // Check high contrast edge with neighbors (text stroke)
          const diff = Math.max(
            Math.abs(val - gray[idx - 1]),
            Math.abs(val - gray[idx + 1]),
            Math.abs(val - gray[idx - width]),
            Math.abs(val - gray[idx + width])
          );
          if (diff >= 35) {
            strokeMask[idx] = 1;
          }
        }
      }
    }

    // Directional morphological dilation: vertically connect characters in columns,
    // horizontally connect lines/words.
    const dilated = new Uint8Array(width * height);
    const vertRadius = 4;
    const horizRadius = 2;

    for (let y = vertRadius; y < height - vertRadius; y++) {
      for (let x = horizRadius; x < width - horizRadius; x++) {
        if (strokeMask[y * width + x] === 1) {
          for (let dy = -vertRadius; dy <= vertRadius; dy++) {
            for (let dx = -horizRadius; dx <= horizRadius; dx++) {
              dilated[(y + dy) * width + (x + dx)] = 1;
            }
          }
        }
      }
    }

    // Find connected components in the dilated stroke map
    const strokeLabels = new Int32Array(width * height);
    let clusterId = 0;

    for (let seed = 0; seed < strokeLabels.length; seed++) {
      if (dilated[seed] !== 1 || strokeLabels[seed] !== 0) continue;
      clusterId++;
      let head = 0;
      let tail = 1;
      let sx0 = width, sy0 = height, sx1 = 0, sy1 = 0;
      queue[0] = seed;
      strokeLabels[seed] = clusterId;

      while (head < tail) {
        const p = queue[head++];
        const x = p % width;
        const y = Math.floor(p / width);
        if (x < sx0) sx0 = x;
        if (y < sy0) sy0 = y;
        if (x > sx1) sx1 = x;
        if (y > sy1) sy1 = y;

        if (x > 0 && dilated[p - 1] === 1 && strokeLabels[p - 1] === 0) {
          strokeLabels[p - 1] = clusterId;
          queue[tail++] = p - 1;
        }
        if (x + 1 < width && dilated[p + 1] === 1 && strokeLabels[p + 1] === 0) {
          strokeLabels[p + 1] = clusterId;
          queue[tail++] = p + 1;
        }
        if (y > 0 && dilated[p - width] === 1 && strokeLabels[p - width] === 0) {
          strokeLabels[p - width] = clusterId;
          queue[tail++] = p - width;
        }
        if (y + 1 < height && dilated[p + width] === 1 && strokeLabels[p + width] === 0) {
          strokeLabels[p + width] = clusterId;
          queue[tail++] = p + width;
        }
      }

      const sw = sx1 - sx0 + 1;
      const sh = sy1 - sy0 + 1;
      const origH = sh * scale;
      const origW = sw * scale;

      // Strict precision column filter to eliminate hair, blush, and screentones:
      // A vertical Japanese text column has height >= 38px and aspect ratio >= 1.55.
      // A horizontal heading/sign has width >= 45px and aspect ratio <= 0.62.
      const isVerticalColumn = origH >= 38 && sh >= sw * 1.55;
      const isHorizontalLine = origW >= 45 && sw >= sh * 1.6;

      if (!isVerticalColumn && !isHorizontalLine) continue;
      if (origH < 35 && origW < 35) continue;
      if (tail < 80) continue;
      // Reject long straight panel frame lines
      if (sw > 10 * sh || sh > 10 * sw) continue;

      // Check edge transitions and dark pixel density
      let darkInCluster = 0;
      let clusterTransitions = 0;
      for (let y = sy0; y <= sy1; y++) {
        let prevDark = false;
        const rowOffset = y * width;
        for (let x = sx0; x <= sx1; x++) {
          const isDark = gray[rowOffset + x] <= 125;
          if (isDark) {
            darkInCluster++;
            if (!prevDark) clusterTransitions++;
          }
          prevDark = isDark;
        }
      }

      // Reject solid black shapes (hair, eyes, shadows)
      const fillDensity = darkInCluster / (sw * sh);
      if (fillDensity > 0.65 || clusterTransitions < 10) continue;

      // Reject hollow borders and panel frames
      if (sw >= 25 && sh >= 25) {
        let centerDark = 0;
        const cxStart = sx0 + Math.floor(sw * 0.25);
        const cxEnd = sx1 - Math.floor(sw * 0.25);
        const cyStart = sy0 + Math.floor(sh * 0.25);
        const cyEnd = sy1 - Math.floor(sh * 0.25);
        for (let y = cyStart; y <= cyEnd; y++) {
          const rowOffset = y * width;
          for (let x = cxStart; x <= cxEnd; x++) {
            if (gray[rowOffset + x] <= 125) centerDark++;
          }
        }
        if (centerDark < 4) continue;
      }

      const origBox = {
        x0: Math.max(0, Math.floor((sx0 - 4) * scale)),
        y0: Math.max(0, Math.floor((sy0 - 4) * scale)),
        x1: Math.min(pixels.width, Math.ceil((sx1 + 5) * scale)),
        y1: Math.min(pixels.height, Math.ceil((sy1 + 5) * scale)),
        orientation: sh >= sw * 0.85 ? ("vertical" as const) : ("horizontal" as const),
        type: "text-cluster" as const,
      };

      // Check if this cluster is already substantially covered by a bubble
      const isAlreadyCovered = rawCandidates.some((bubble) => {
        const overlapX = Math.max(0, Math.min(bubble.x1, origBox.x1) - Math.max(bubble.x0, origBox.x0));
        const overlapY = Math.max(0, Math.min(bubble.y1, origBox.y1) - Math.max(bubble.y0, origBox.y0));
        const overlapArea = overlapX * overlapY;
        const clusterArea = (origBox.x1 - origBox.x0) * (origBox.y1 - origBox.y0);
        return overlapArea / clusterArea > 0.45;
      });

      if (!isAlreadyCovered) {
        rawCandidates.push(origBox);
      }
    }
  }

  // =========================================================================
  // Pass 3: Margin Trimming, Deduplication & Reading Order Sorting
  // =========================================================================
  // 1. Filter out page margin numbers / edge gutter noise (outer 1.5% margins)
  const edgeMarginX = pixels.width * 0.015;
  const edgeMarginY = pixels.height * 0.015;

  const validBoxes = rawCandidates.filter((b) => {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    if (w < 16 || h < 16) return false;
    // Page numbers / edge markings
    if (b.y1 > pixels.height - edgeMarginY && h < 35 && w < 100) return false;
    if (b.y0 < edgeMarginY && h < 35 && w < 100) return false;
    if (b.x0 < edgeMarginX && b.x1 < edgeMarginX * 3 && w < 30) return false;
    if (b.x1 > pixels.width - edgeMarginX && b.x0 > pixels.width - edgeMarginX * 3 && w < 30) return false;
    return true;
  });

  // 2. Merge overlapping boxes (IoU > 0.35 or significant containment)
  const merged: CandidateBox[] = [];
  for (const box of validBoxes) {
    const existing = merged.find((m) => {
      const ox = Math.max(0, Math.min(m.x1, box.x1) - Math.max(m.x0, box.x0));
      const oy = Math.max(0, Math.min(m.y1, box.y1) - Math.max(m.y0, box.y0));
      const overlapArea = ox * oy;
      const minArea = Math.min((m.x1 - m.x0) * (m.y1 - m.y0), (box.x1 - box.x0) * (box.y1 - box.y0));
      return overlapArea / minArea > 0.35;
    });

    if (existing) {
      existing.x0 = Math.min(existing.x0, box.x0);
      existing.y0 = Math.min(existing.y0, box.y0);
      existing.x1 = Math.max(existing.x1, box.x1);
      existing.y1 = Math.max(existing.y1, box.y1);
      existing.orientation = (existing.y1 - existing.y0) >= (existing.x1 - existing.x0) * 0.85 ? "vertical" : "horizontal";
    } else {
      merged.push({ ...box });
    }
  }

  // 3. Sort in standard Japanese Manga Reading Order (Top-to-Bottom, Right-to-Left)
  merged.sort((a, b) => {
    const verticalBandHeight = pixels.height * 0.16;
    const aBand = Math.floor(a.y0 / verticalBandHeight);
    const bBand = Math.floor(b.y0 / verticalBandHeight);
    if (aBand !== bBand) {
      return aBand - bBand; // Earlier vertical band first (top to bottom)
    }
    // Within the same panel band, rightmost column first (right to left)
    return b.x0 - a.x0;
  });

  return merged.map((box, index) => ({
    id: `dialogue-${index + 1}`,
    bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
    orientation: box.orientation,
    type: box.type,
  }));
}

/** Identify enclosed white interiors, so column spacing is not the only cue (preserved for backwards-compat). */
export function findBubbleMembership(fragments: OcrFragment[], pixels?: Pixels): Map<OcrFragment, number> {
  const membership = new Map<OcrFragment, number>();
  if (!pixels) return membership;
  const scale = Math.max(1, Math.max(pixels.width, pixels.height) / 1536);
  const width = Math.ceil(pixels.width / scale), height = Math.ceil(pixels.height / scale);
  const labels = new Int32Array(width * height);
  // Minimum pooling keeps thin bubble outlines closed when reducing the image.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let white = true;
    for (let sy = Math.floor(y * scale); sy < Math.min(pixels.height, Math.ceil((y + 1) * scale)) && white; sy++) {
      for (let sx = Math.floor(x * scale); sx < Math.min(pixels.width, Math.ceil((x + 1) * scale)); sx++) {
        const p = (sy * pixels.width + sx) * 4;
        if (pixels.data[p] * .299 + pixels.data[p + 1] * .587 + pixels.data[p + 2] * .114 < 205) { white = false; break; }
      }
    }
    labels[y * width + x] = white ? -1 : 0;
  }
  const queue = new Int32Array(labels.length);
  const interiors = new Map<number, { area: number; x0: number; y0: number; x1: number; y1: number }>();
  let id = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] !== -1) continue;
    id++;
    let head = 0, tail = 1, edge = false;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    queue[0] = seed; labels[seed] = id;
    const visit = (next: number) => { if (labels[next] === -1) { labels[next] = id; queue[tail++] = next; } };
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      if (x > 0) visit(p - 1);
      if (x + 1 < width) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y + 1 < height) visit(p + width);
    }
    const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!edge && tail >= 32 && tail / boxArea >= .3) interiors.set(id, {
      area: tail * scale * scale, x0: x0 * scale, y0: y0 * scale, x1: (x1 + 1) * scale, y1: (y1 + 1) * scale,
    });
  }
  for (const fragment of fragments) {
    const b = fragment.bbox;
    const counts = new Map<number, number>();
    let samples = 0;
    for (let row = 0; row < 12; row++) for (let col = 0; col < 8; col++) {
      const x = Math.floor((b.x0 + (col + .5) * (b.x1 - b.x0) / 8) / scale);
      const y = Math.floor((b.y0 + (row + .5) * (b.y1 - b.y0) / 12) / scale);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      samples++;
      const label = labels[y * width + x];
      if (interiors.has(label)) counts.set(label, (counts.get(label) || 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < samples * .35) continue;
    const interior = interiors.get(best[0])!;
    const boxArea = (b.x1 - b.x0) * (b.y1 - b.y0);
    // Eyes, glyph counters and huge panel backgrounds are not speech bubbles.
    if (interior.area < boxArea * .6 ||
      ([...fragment.text].length <= 1 && interior.area < boxArea * 5) ||
      (interior.x1 - interior.x0) * (interior.y1 - interior.y0) > boxArea * 40 ||
      b.x0 < interior.x0 - scale * 2 || b.y0 < interior.y0 - scale * 2 ||
      b.x1 > interior.x1 + scale * 2 || b.y1 > interior.y1 + scale * 2) continue;
    membership.set(fragment, best[0]);
  }
  return membership;
}

