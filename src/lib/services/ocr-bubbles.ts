import type { OcrFragment } from "./ocr-engine";

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Identify enclosed white interiors, so column spacing is not the only cue. */
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
