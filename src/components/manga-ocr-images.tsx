import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ScanText, Crop, X } from "lucide-react";
import { cropViewportBox, cropCanvasRegion, ocrCropScale } from "~lib/services/image-cropper";
import { detectMangaDialogueRegions } from "~lib/services/ocr-bubbles";
import { canvasToImage, imageToCanvas, mapCropFragments, transformOcrFragment, overlapFraction, ocrDisplayBounds, resolveOcrDisplayOverlaps, type ImageMapping, type Bounds } from "~lib/services/ocr-geometry";
import { resolveOcrRegionOverlaps, type OcrTextRegion } from "~lib/services/ocr-regions";
import { assembleOcrRegions, classifyOcrFailure } from "~lib/services/ocr-pipeline";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";
import type { OcrCropItem, OcrCropResult, OcrExecutionResult, OcrFragment } from "~lib/services/ocr-engine";

type Highlight = { id: string; text: string; imageUrl: string; x: number; y: number; width: number; height: number; region: OcrTextRegion };
type ScannedImage = { image: HTMLImageElement; src: string; highlights: Highlight[] };
type PreparedImage = { canvas: HTMLCanvasElement; source: string; mapping: ImageMapping };

type DragBox = { startX: number; startY: number; currentX: number; currentY: number };
const transformRegion = (region: OcrTextRegion, transform: (bounds: Bounds) => Bounds): OcrTextRegion => ({
  ...region, bbox: transform(region.bbox), fragments: region.fragments.map(fragment => transformOcrFragment(fragment, transform)),
});
const normalizedBounds = (bounds: Bounds, mapping: ImageMapping): Bounds => {
  const b = canvasToImage(bounds, mapping);
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
};
// Continuous inverse for stored evidence; unlike selection cropping, do not
// round or clamp glyphs each time a user selects the same passage.
const sourceBounds = (b: Bounds, m: ImageMapping): Bounds => ({
  x0: (b.x0 - m.x) / m.width * m.canvasWidth, y0: (b.y0 - m.y) / m.height * m.canvasHeight,
  x1: (b.x1 - m.x) / m.width * m.canvasWidth, y1: (b.y1 - m.y) / m.height * m.canvasHeight,
});

const standaloneImage = (): HTMLImageElement | null =>
  document.contentType.startsWith("image/") ? document.images[0] ?? null : null;

export function MangaOcrImages() {
  const { settings } = useSettingsStore();
  const { t } = useTranslation();
  const [hoveredImage, setHoveredImage] = useState<HTMLImageElement | null>(standaloneImage);
  const [scans, setScans] = useState<ScannedImage[]>([]);
  const scansRef = useRef<ScannedImage[]>([]);
  scansRef.current = scans;
  const [busyImage, setBusyImage] = useState<HTMLImageElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [, setLayoutVersion] = useState(0);

  const capturingRef = useRef(false);
  const scanningRef = useRef(false);
  const scanIdRef = useRef(0);
  const isSelectingRef = useRef(false);
  isSelectingRef.current = isSelectingBox;

  // Track hover and layout changes
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (capturingRef.current || dragBox) return;
      const target = event.target;
      if (target instanceof HTMLImageElement && target.isConnected) {
        setHoveredImage(target);
      } else if (
        !(event.composedPath() as EventTarget[]).some(
          (item) => item instanceof HTMLElement && item.dataset?.hakkutsuMangaOcr === "true"
        )
      ) {
        if (!isSelectingRef.current) {
          setHoveredImage(standaloneImage());
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setError(null);
        setIsSelectingBox(false);
        setDragBox(null);
      }
    };

    const onLayout = () => setLayoutVersion((version) => version + 1);
    const onImageLoad = () => {
      const image = standaloneImage();
      if (image) { setHoveredImage(image); onLayout(); }
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("load", onImageLoad, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("load", onImageLoad, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  }, [dragBox]);

  // Readers can move or resize images without a window resize/scroll event.
  // Reproject only when their layout changes, including animated lightboxes.
  useEffect(() => {
    if ((!scans.length && !hoveredImage) || typeof cancelAnimationFrame !== "function") return;
    const tracked = scans.map(({ image, src }) => ({ image, src }));
    if (hoveredImage && !tracked.some(({ image }) => image === hoveredImage)) {
      tracked.push({ image: hoveredImage, src: hoveredImage.currentSrc });
    }
    const layout = () => tracked.map(({ image, src }) => {
      if (!image.isConnected || image.currentSrc !== src) return "detached";
      const r = image.getBoundingClientRect();
      return `${r.left}:${r.top}:${r.width}:${r.height}`;
    }).join("|");
    let previous = layout();
    let frame: number;
    const follow = () => {
      const current = layout();
      if (current !== previous) { previous = current; setLayoutVersion(version => version + 1); }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [scans, hoveredImage]);

  /**
   * Loads the full-resolution image canvas or screen crop.
   */
  const prepareImageCanvas = useCallback(
    async (image: HTMLImageElement) => {
      const source = image.currentSrc;
      const rect = image.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);

      try {
        const response = await chrome.runtime.sendMessage({
          type: "FETCH_IMAGE",
          payload: { url: source },
        });
        if (!response?.payload?.dataUrl) throw new Error("Original image unavailable");
        const original = new Image();
        original.src = response.payload.dataUrl;
        await original.decode();
        const scale = Math.min(1, 4096 / Math.max(original.naturalWidth, original.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not prepare OCR image");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(original, 0, 0, canvas.width, canvas.height);
        return { canvas, source, mapping: {
          x: 0, y: 0, width: 1, height: 1, canvasWidth: canvas.width, canvasHeight: canvas.height,
        } };
      } catch {
        if (right <= left || bottom <= top) throw new Error("Image is outside the viewport");
        const response = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
        if (!response?.payload?.dataUrl) throw new Error(response?.payload?.error || "Could not capture image");
        const dataUrl = await cropViewportBox(
          response.payload.dataUrl,
          {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
            dpr: window.devicePixelRatio,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
          false
        );
        const screenshotImg = new Image();
        screenshotImg.src = dataUrl;
        await screenshotImg.decode();
        const canvas = document.createElement("canvas");
        canvas.width = screenshotImg.naturalWidth;
        canvas.height = screenshotImg.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not prepare screenshot canvas");
        context.drawImage(screenshotImg, 0, 0);
        return { canvas, source, mapping: {
          x: (left - rect.left) / rect.width, y: (top - rect.top) / rect.height,
          width: (right - left) / rect.width, height: (bottom - top) / rect.height,
          canvasWidth: canvas.width, canvasHeight: canvas.height,
        } };
      }
    },
    []
  );

  const makeHighlight = (prepared: PreparedImage, region: OcrTextRegion, id: string): Highlight => {
    const b = region.bbox;
    const padding = Math.max(2, Math.min(b.x1 - b.x0, b.y1 - b.y0) * .08);
    const bounds = {
      x0: Math.max(0, Math.floor(b.x0 - padding)), y0: Math.max(0, Math.floor(b.y0 - padding)),
      x1: Math.min(prepared.canvas.width, Math.ceil(b.x1 + padding)),
      y1: Math.min(prepared.canvas.height, Math.ceil(b.y1 + padding)),
    };
    const { dataUrl } = cropCanvasRegion(prepared.canvas, {
      x: bounds.x0, y: bounds.y0, width: bounds.x1 - bounds.x0, height: bounds.y1 - bounds.y0,
    }, false);
    return { id, text: region.text, imageUrl: dataUrl, ...canvasToImage(b, prepared.mapping),
      region: transformRegion(region, bounds => normalizedBounds(bounds, prepared.mapping)) };
  };

  /** Both selection paths use original pixels for geometry and attachments. */
  const recognizeRegions = async (prepared: PreparedImage, scanId: number, manual: boolean, selection?: Bounds) => {
    const { canvas } = prepared;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not acquire 2D canvas context");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const scanBox = selection || { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height };
    const selectedCanvas = selection ? cropCanvasRegion(canvas, {
      x: scanBox.x0, y: scanBox.y0, width: scanBox.x1 - scanBox.x0, height: scanBox.y1 - scanBox.y0,
    }, false).canvas : canvas;
    const selectedPixels = selection ? selectedCanvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, selectedCanvas.width, selectedCanvas.height) : pixels;
    // Keep closed-bubble evidence from the available original image. Cropping
    // its outline first can turn a readable upper bubble into edge noise.
    let detected = detectMangaDialogueRegions(pixels, { includeBorderlessText: true }).flatMap(region => {
      const bbox = { x0: Math.max(scanBox.x0, region.bbox.x0), y0: Math.max(scanBox.y0, region.bbox.y0),
        x1: Math.min(scanBox.x1, region.bbox.x1), y1: Math.min(scanBox.y1, region.bbox.y1) };
      return bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0 ? [{ ...region, bbox }] : [];
    });
    if (selection && !detected.length) detected = detectMangaDialogueRegions(selectedPixels, { includeBorderlessText: true }).map(region => ({
      ...region, bbox: { x0: region.bbox.x0 + scanBox.x0, y0: region.bbox.y0 + scanBox.y0,
        x1: region.bbox.x1 + scanBox.x0, y1: region.bbox.y1 + scanBox.y0 },
    }));
    const makeCrop = (b: Bounds, index: number, orientationHint?: "vertical" | "horizontal", textSize?: number, textColumn = false): OcrCropItem => {
      const crop = cropCanvasRegion(canvas, {
        x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0,
      }, settings.ocrPreprocessEnabled !== false, { padding: 10,
        scale: ocrCropScale(b.x1 - b.x0, b.y1 - b.y0, textSize) });
      return {
        id: `${scanId}:${index}`, dataUrl: crop.dataUrl,
        width: crop.canvas.width, height: crop.canvas.height, bbox: b, transform: crop.transform,
        orientation: settings.ocrDefaultOrientation || "auto", orientationHint,
        adaptiveThreshold: settings.ocrPreprocessEnabled !== false,
        textColumn,
      };
    };
    const crops = detected.map((region, index) => makeCrop(region.bbox, index, region.orientationAmbiguous ? undefined : region.orientation, region.textSize, region.textColumn));
    // A tight sign or sound-effect selection may be too small for automatic
    // detection. It still needs crop segmentation instead of page segmentation.
    if (manual && !crops.length) {
      crops.push(makeCrop(scanBox, 0));
    }
    const options = { pixels, manual, automatic: !manual };
    let fragments: OcrFragment[] = [];
    let recognizedText = false;
    let cropFailed = false;
    if (crops.length) {
      setStatusMessage(`${t("ocr_scanning")} (${crops.length})`);
      const response = await chrome.runtime.sendMessage({ type: "RUN_MANGA_OCR_BATCH", payload: { crops } });
      if (response?.type === "MANGA_OCR_BATCH_RESULT" && Array.isArray(response.payload)) {
        cropFailed = response.payload.length > 0 && response.payload.every((result: OcrCropResult) => result.error);
        fragments = (response.payload as OcrCropResult[]).flatMap(result => {
          recognizedText ||= /[\u3040-\u30ff\u3400-\u9fff]/u.test(result.text || "");
          const crop = crops.find(c => c.id === result.id);
          if (!crop) return [];
          // Manual selection may expose a low-confidence transcription even
          // when Tesseract has no usable fragment boxes. Keep it editable.
          const padding = crop.transform?.padding || 0;
          const lines = result.lines?.length ? result.lines : manual && result.text?.trim() ? [{
            text: result.text.trim(), confidence: result.confidence, orientation: result.orientation,
            bbox: { x0: padding, y0: padding, x1: crop.width - padding, y1: crop.height - padding },
          }] : [];
          return mapCropFragments(lines, crop);
        });
      } else cropFailed = true;
    }

    // Recover uncovered text once, even when some detected crops succeeded.
    setStatusMessage(t("ocr_recognizing"));
    const full = cropCanvasRegion(canvas, { x: scanBox.x0, y: scanBox.y0, width: scanBox.x1 - scanBox.x0, height: scanBox.y1 - scanBox.y0 },
      settings.ocrPreprocessEnabled !== false);
    const response = await chrome.runtime.sendMessage({
      type: "RUN_MANGA_OCR", payload: {
        imageDataUrl: full.dataUrl, orientation: settings.ocrDefaultOrientation || "auto",
        boxWidth: full.canvas.width, boxHeight: full.canvas.height,
      },
    });
    let recovered: OcrFragment[] = [];
    if (response?.type === "MANGA_OCR_RESULT") {
      const result = response.payload as OcrExecutionResult;
      recognizedText ||= /[\u3040-\u30ff\u3400-\u9fff]/u.test(result.text || "");
      const lines = result.lines?.length ? result.lines : manual && !fragments.length && result.text?.trim() ? [{
        text: result.text.trim(), orientation: result.orientation, confidence: result.confidence,
        bbox: { x0: 0, y0: 0, x1: full.canvas.width, y1: full.canvas.height },
      }] : [];
      recovered = mapCropFragments(lines, { id: `${scanId}:page`, bbox: scanBox, dataUrl: full.dataUrl,
        width: full.canvas.width, height: full.canvas.height, transform: full.transform });
      if (cropFailed && !fragments.length && !recovered.length && !recognizedText) {
        throw new Error(t("ocr_recognition_failed"));
      }
    } else if (!fragments.length) {
      throw new Error(t("ocr_recognition_failed"));
    }
    recognizedText ||= fragments.length > 0 || recovered.length > 0;
    const regions = assembleOcrRegions(fragments, recovered, options);
    regions.sort((a, b) => {
      const overlapY = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
      return overlapY > Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) * .5
        ? b.bbox.x0 - a.bbox.x0 : a.bbox.y0 - b.bbox.y0;
    });
    return { regions, pixels, failure: classifyOcrFailure(detected.length, recognizedText) };
  };

  const scan = async (image: HTMLImageElement, selection?: Bounds) => {
    if (scanningRef.current) return;
    const source = image.currentSrc;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setBusyImage(image);
    setError(null);
    setStatusMessage(t("ocr_detecting"));
    capturingRef.current = scanningRef.current = true;
    setIsSelectingBox(false);
    setDragBox(null);
    window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } }));
    try {
      // Let React remove OCR controls before a screenshot fallback.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!image.isConnected || image.currentSrc !== source) return;
      const prepared: PreparedImage = await prepareImageCanvas(image);
      if (!image.isConnected || image.currentSrc !== source || prepared.source !== source) return;
      let selectedArea: ReturnType<typeof canvasToImage> | undefined;
      let selectionBounds: Bounds | undefined;
      if (selection) {
        const bounds = imageToCanvas(selection, prepared.mapping);
        if (!bounds) throw new Error(t("ocr_no_text"));
        selectedArea = canvasToImage(bounds, prepared.mapping);
        selectionBounds = bounds;
      }
      const recognition = await recognizeRegions(prepared, ++scanIdRef.current, Boolean(selection), selectionBounds);
      let regions = recognition.regions;
      if (!image.isConnected || image.currentSrc !== source) return;
      if (!regions.length) throw new Error(t(recognition.failure));
      const previous = scansRef.current.find(item => item.image === image && item.src === source);
      const outside = selectedArea ? (previous?.highlights || []).filter(h =>
          overlapFraction({ x0: h.x, y0: h.y, x1: h.x + h.width, y1: h.y + h.height }, {
            x0: selectedArea!.x, y0: selectedArea!.y,
            x1: selectedArea!.x + selectedArea!.width, y1: selectedArea!.y + selectedArea!.height,
          }) === 0) : [];
      if (selection) {
        const touched = (previous?.highlights || []).filter(h => !outside.includes(h));
        regions = assembleOcrRegions(touched.flatMap(h => h.region.fragments.map(f =>
          transformOcrFragment(f, b => sourceBounds(b, prepared.mapping)))), regions.flatMap(r => r.fragments), {
          manual: true, pixels: recognition.pixels,
        });
      }
      const fresh = regions.map((region, index) => makeHighlight(prepared, region, `${scanIdRef.current}:region:${index}`));
      const final = resolveOcrRegionOverlaps([...outside.map(h => h.region), ...fresh.map(h => h.region)]);
      const combined = final.map(region => [...outside, ...fresh].find(h => h.region === region) ||
        makeHighlight(prepared, transformRegion(region, b => sourceBounds(b, prepared.mapping)), `${scanIdRef.current}:salvaged:${final.indexOf(region)}`));
      const highlights = combined.filter(h => !outside.includes(h));
      const next = [...scansRef.current.filter(item => item.image !== image && item.image.isConnected).slice(-19),
        { image, src: source, highlights: combined }];
      scansRef.current = next;
      setScans(next);
      if (selection && highlights.length === 1) {
        const highlight = highlights[0];
        const currentRect = image.getBoundingClientRect();
        window.dispatchEvent(new CustomEvent("hakkutsu:analyze", { detail: {
          text: highlight.text, x: currentRect.left + (highlight.x + highlight.width / 2) * currentRect.width,
          y: currentRect.top + (highlight.y + highlight.height) * currentRect.height,
          mode: "dictionary", transient: false, imageUrl: highlight.imageUrl,
          pauseVideo: false, ocrRegionId: highlight.id,
        } }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      capturingRef.current = scanningRef.current = false;
      setBusyImage(null);
      setStatusMessage(null);
      setIsSelectingBox(false);
      setDragBox(null);
    }
  };

  const scanImage = (image: HTMLImageElement) => scan(image);
  const scanCustomBox = (image: HTMLImageElement, box: { left: number; top: number; width: number; height: number }) => {
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    return scan(image, {
      x0: Math.max(0, (box.left - rect.left) / rect.width),
      y0: Math.max(0, (box.top - rect.top) / rect.height),
      x1: Math.min(1, (box.left + box.width - rect.left) / rect.width),
      y1: Math.min(1, (box.top + box.height - rect.top) / rect.height),
    });
  };

  useEffect(() => {
    const update = (event: Event) => {
      const { id, text } = (event as CustomEvent<{ id: string; text: string }>).detail;
      setScans(current => current.map(item => ({ ...item,
        highlights: item.highlights.map(h => h.id === id ? { ...h, text, region: { ...h.region, text } } : h),
      })));
    };
    window.addEventListener("hakkutsu:ocr-region-updated", update);
    return () => window.removeEventListener("hakkutsu:ocr-region-updated", update);
  }, []);

  const imageRect = hoveredImage?.isConnected ? hoveredImage.getBoundingClientRect() : null;
  const showControls =
    imageRect &&
    imageRect.width > 0 &&
    imageRect.height > 0 &&
    imageRect.bottom > 0 &&
    imageRect.right > 0 &&
    imageRect.top < window.innerHeight &&
    imageRect.left < window.innerWidth;
  const emptyResult = [t("ocr_no_text_hint"), t("ocr_unreadable_text"), t("ocr_rejected_text")].includes(error || "");

  // Handle Drag-to-Select interaction directly on image or overlay
  const handleMouseDown = (e: React.MouseEvent) => {
    if (busyImage !== null) return;
    e.preventDefault();
    setDragBox({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragBox) return;
    setDragBox((prev) => (prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null));
  };

  const handleMouseUp = () => {
    if (!dragBox || !hoveredImage) {
      setDragBox(null);
      return;
    }

    const boxLeft = Math.min(dragBox.startX, dragBox.currentX);
    const boxTop = Math.min(dragBox.startY, dragBox.currentY);
    const boxWidth = Math.abs(dragBox.currentX - dragBox.startX);
    const boxHeight = Math.abs(dragBox.currentY - dragBox.startY);

    if (boxWidth >= 14 && boxHeight >= 14) {
      void scanCustomBox(hoveredImage, {
        left: boxLeft,
        top: boxTop,
        width: boxWidth,
        height: boxHeight,
      });
    } else {
      setDragBox(null);
    }
  };

  // Resolve in displayed coordinates across every scanned image, not just
  // within one page. Hidden alternatives remain retained for later layouts.
  const displayed = resolveOcrDisplayOverlaps([...scans].reverse().flatMap(scan => {
    if (!scan.image.isConnected || scan.image.currentSrc !== scan.src) return [];
    const rect = scan.image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    return scan.highlights.map(highlight => ({ highlight,
      bbox: ocrDisplayBounds({ x0: highlight.x, y0: highlight.y,
        x1: highlight.x + highlight.width, y1: highlight.y + highlight.height }, rect),
    })).filter(({ bbox: b }) => b.x1 > 0 && b.y1 > 0 && b.x0 < window.innerWidth && b.y0 < window.innerHeight);
  }));

  return (
    <>
      <style>{`
        .hk-manga-region {
          box-sizing: border-box;
          background: rgba(56, 189, 248, 0.08);
          box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.65);
          transition: background 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
        }
        .hk-manga-region:hover, .hk-manga-region:focus-visible {
          background: rgba(56, 189, 248, 0.28);
          box-shadow: inset 0 0 0 2px #38bdf8;
        }
        .hk-manga-select-marquee {
          border: 2px dashed #38bdf8;
          background: rgba(56, 189, 248, 0.22);
          box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
          pointer-events: none;
        }
      `}</style>

      {/* Floating Toolbar with Manga OCR & Select Box buttons */}
      {showControls && !capturingRef.current && (
        <div
          data-hakkutsu-manga-ocr="true"
          style={{
            position: "fixed",
            zIndex: 2147483646,
            pointerEvents: "auto",
            top: Math.max(8, imageRect.top + 8),
            left: Math.max(8, Math.min(window.innerWidth - 240, imageRect.right - 230)),
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {/* 1. Manga OCR Auto Scan Button */}
          <button
            type="button"
            data-hakkutsu-manga-ocr="true"
            title={error || t("ocr_btn_trigger")}
            aria-label={t("ocr_btn_trigger")}
            onClick={() => hoveredImage && void scanImage(hoveredImage)}
            disabled={busyImage !== null}
            style={{
              cursor: busyImage !== null ? "default" : "pointer",
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              gap: 5,
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,.35)",
              background: error && !emptyResult ? "#7f1d1d" : "#141418",
              color: "white",
              font: "600 12px system-ui",
              boxShadow: "0 2px 10px rgba(0,0,0,.5)",
            }}
          >
            {busyImage === hoveredImage ? <Loader2 size={14} className="hk-spin" /> : <ScanText size={14} />}
            {statusMessage || t("ocr_btn_trigger")}
          </button>

          {/* 2. Drag-to-Select (Snipping) Button */}
          <button
            type="button"
            data-hakkutsu-manga-ocr="true"
            title={t("ocr_select_box_hint")}
            aria-label={t("ocr_btn_select_box")}
            onClick={() => { setError(null); setIsSelectingBox((prev) => !prev); }}
            aria-pressed={isSelectingBox}
            disabled={busyImage !== null}
            style={{
              cursor: busyImage !== null ? "default" : "pointer",
              padding: "6px 9px",
              display: "flex",
              alignItems: "center",
              gap: 5,
              borderRadius: 7,
              border: isSelectingBox ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,.35)",
              background: isSelectingBox ? "#0284c7" : "#1e1e24",
              color: "white",
              font: "600 12px system-ui",
              boxShadow: "0 2px 10px rgba(0,0,0,.5)",
            }}
          >
            <Crop size={14} />
            {t("ocr_btn_select_box")}
          </button>
        </div>
      )}

      {/* Error / Empty-State Hint Toast */}
      {showControls && error && !capturingRef.current && (
        <div
          data-hakkutsu-manga-ocr="true"
          role={emptyResult ? "status" : "alert"}
          style={{
            position: "fixed",
            zIndex: 2147483646,
            pointerEvents: "auto",
            top: Math.max(8, imageRect.top + 46),
            left: Math.max(8, Math.min(window.innerWidth - 300, imageRect.right - 300)),
            boxSizing: "border-box",
            maxWidth: Math.min(290, window.innerWidth - 16),
            padding: "7px 10px",
            borderRadius: 7,
            background: emptyResult ? "#1e1e24" : "#7f1d1d",
            color: "white",
            font: "12px system-ui",
            boxShadow: "0 4px 12px rgba(0,0,0,.6)",
            lineHeight: 1.4,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" aria-label={t("dict_btn_close")} title={t("dict_btn_close")}
              onClick={() => setError(null)} style={{ display: "flex", padding: 2, border: 0,
                background: "transparent", color: "inherit", cursor: "pointer" }}><X size={14} /></button>
          </div>
          <button type="button" onClick={() => { setError(null); setIsSelectingBox(true); }}
            disabled={busyImage !== null} style={{ display: "flex", alignItems: "center", gap: 5,
              marginTop: 8, padding: "5px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,.35)",
              background: "transparent", color: "inherit", font: "600 12px system-ui", cursor: "pointer" }}>
            <Crop size={14} />{t("ocr_btn_select_box")}
          </button>
        </div>
      )}

      {/* Drag-to-Select Capture Overlay */}
      {isSelectingBox && imageRect && (
        <div
          data-hakkutsu-manga-ocr="true"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            position: "fixed",
            left: imageRect.left,
            top: imageRect.top,
            width: imageRect.width,
            height: imageRect.height,
            zIndex: 2147483644,
            cursor: "crosshair",
            background: dragBox ? "rgba(0,0,0,0.15)" : "transparent",
            pointerEvents: "auto",
          }}
        >
          {dragBox && (
            <div
              className="hk-manga-select-marquee"
              style={{
                position: "fixed",
                left: Math.min(dragBox.startX, dragBox.currentX),
                top: Math.min(dragBox.startY, dragBox.currentY),
                width: Math.abs(dragBox.currentX - dragBox.startX),
                height: Math.abs(dragBox.currentY - dragBox.startY),
                zIndex: 2147483645,
              }}
            />
          )}
        </div>
      )}

      {/* Render Detected OCR Highlights */}
      {!capturingRef.current &&
        displayed.map(({ highlight, bbox }) => {
            const x = bbox.x0, y = bbox.y0;
            const width = bbox.x1 - x, height = bbox.y1 - y;

            return (
              <button
                key={highlight.id}
                type="button"
                className="hk-manga-region"
                data-hakkutsu-manga-ocr="true"
                aria-label={highlight.text}
                title={highlight.text}
                aria-haspopup="dialog"
                onClick={(event) =>
                  window.dispatchEvent(
                    new CustomEvent("hakkutsu:analyze", {
                      detail: {
                        text: highlight.text,
                        x: x + width / 2,
                        y: y + height,
                        mode: "dictionary",
                        transient: false,
                        imageUrl: highlight.imageUrl,
                        pauseVideo: false,
                        ocrRegionId: highlight.id,
                        returnFocus: event.currentTarget,
                      },
                    })
                  )
                }
                style={{
                  appearance: "none",
                  display: "block",
                  boxSizing: "border-box",
                  position: "fixed",
                  zIndex: 2147483645,
                  pointerEvents: "auto",
                  cursor: "pointer",
                  left: x,
                  top: y,
                  width,
                  height,
                  minWidth: 0,
                  minHeight: 0,
                  maxWidth: "none",
                  maxHeight: "none",
                  margin: 0,
                  padding: 0,
                  border: 0,
                  outline: 0,
                  overflow: "hidden",
                  transform: "none",
                  fontSize: 0,
                  lineHeight: 0,
                  borderRadius: 4,
                  color: "transparent",
                }}
              />
            );
        })}
    </>
  );
}
