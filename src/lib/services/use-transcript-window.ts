import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { transcriptOffsets, transcriptRowAt, transcriptWindow } from "./transcript-layout";

/** Measure variable-height cues and keep scroll position when estimates settle. */
export function useTranscriptWindow(
  listRef: React.RefObject<HTMLDivElement>,
  rows: { index: number; estimate: number }[],
  resetKey: unknown,
  enabled = true,
) {
  const measured = useRef(new Map<number, number>());
  const [revision, setRevision] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 320 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const offsets = useMemo(() => transcriptOffsets(rows.map((row) => measured.current.get(row.index) ?? row.estimate)), [rows, revision]);
  const latest = useRef({ rows, offsets });
  latest.current = { rows, offsets };
  const visible = transcriptWindow(offsets, viewport.top, viewport.height);

  useLayoutEffect(() => {
    measured.current.clear();
    if (listRef.current) listRef.current.scrollTop = 0;
    setViewport((previous) => ({ ...previous, top: 0 }));
    setRevision((value) => value + 1);
  }, [resetKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (viewportRef.current.width !== list.clientWidth) {
        measured.current.clear();
        setRevision((value) => value + 1);
      }
      setViewport((previous) => {
        const next = { top: list.scrollTop, height: list.clientHeight, width: list.clientWidth };
        return previous.top === next.top && previous.height === next.height && previous.width === next.width ? previous : next;
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(list);
    list.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { observer.disconnect(); list.removeEventListener("scroll", schedule); if (frame) cancelAnimationFrame(frame); };
  }, [listRef, enabled]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { rows: currentRows, offsets: currentOffsets } = latest.current;
      const anchor = transcriptRowAt(currentOffsets, list.scrollTop);
      let changed = false;
      for (const element of list.querySelectorAll<HTMLElement>("[data-transcript-row]")) {
        const index = Number(element.dataset.transcriptRow);
        const height = element.offsetHeight + 6;
        if (height > 6 && measured.current.get(index) !== height) { measured.current.set(index, height); changed = true; }
      }
      if (!changed) return;
      const next = transcriptOffsets(currentRows.map((row) => measured.current.get(row.index) ?? row.estimate));
      // Rows above the viewport may settle while scrolling. Preserve the anchor.
      const adjustment = next[anchor] - currentOffsets[anchor];
      if (adjustment) list.scrollTop += adjustment;
      setViewport((previous) => ({ ...previous, top: list.scrollTop }));
      setRevision((value) => value + 1);
    };
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(update); });
    for (const element of list.querySelectorAll("[data-transcript-row]")) observer.observe(element);
    frame = requestAnimationFrame(update);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [visible.start, visible.end, rows, viewport.width, enabled]);

  const scrollToRow = useCallback((index: number, smooth = true) => {
    const list = listRef.current;
    const { rows: currentRows, offsets: currentOffsets } = latest.current;
    const position = currentRows.findIndex((row) => row.index === index);
    if (!list || position < 0) return;
    const top = Math.max(0, currentOffsets[position] - list.clientHeight / 2 + (currentOffsets[position + 1] - currentOffsets[position]) / 2);
    const nearby = Math.abs(top - list.scrollTop) < list.clientHeight && measured.current.has(index);
    list.scrollTo({ top, behavior: smooth && nearby ? "smooth" : "auto" });
  }, [listRef]);
  return { ...visible, scrollToRow, width: viewport.width };
}
