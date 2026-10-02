export function transcriptOffsets(heights: number[]): number[] {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1] + Math.max(1, height));
  return offsets;
}

export function transcriptRowAt(offsets: number[], position: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function transcriptWindow(offsets: number[], top: number, viewport: number, overscan = 500) {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0, before: 0, after: 0 };
  const start = transcriptRowAt(offsets, Math.max(0, top - overscan));
  const end = Math.min(count, transcriptRowAt(offsets, top + viewport + overscan) + 1);
  return { start, end, before: offsets[start], after: offsets[count] - offsets[end] };
}
