import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ScanText, Crop } from "lucide-react";
import { applyMangaPreprocess, cropViewportBox, cropCanvasRegion } from "~lib/services/image-cropper";
import { detectMangaDialogueRegions } from "~lib/services/ocr-bubbles";
import { groupOcrRegions } from "~lib/services/ocr-regions";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";
import type { OcrCropItem, OcrExecutionResult } from "~lib/services/ocr-engine";

type Highlight = { id: string; text: string; imageUrl: string; x: number; y: number; width: number; height: number };
type ScannedImage = { image: HTMLImageElement; src: string; highlights: Highlight[] };
type DragBox = { startX: number; startY: number; currentX: number; currentY: number };

export function MangaOcrImages() {
  const { settings } = useSettingsStore();
  const { t } = useTranslation();
  const [hoveredImage, setHoveredImage] = useState<HTMLImageElement | null>(null);
  const [scans, setScans] = useState<ScannedImage[]>([]);
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
          setHoveredImage(null);
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSelectingBox(false);
        setDragBox(null);
      }
    };

    const onLayout = () => setLayoutVersion((version) => version + 1);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  }, [dragBox]);

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
        const scale = Math.min(2, 4096 / Math.max(original.naturalWidth, original.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not prepare OCR image");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(original, 0, 0, canvas.width, canvas.height);
        return { canvas, fullImage: true, source, rect, left, top, right, bottom };
      } catch {
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
        return { canvas, fullImage: false, source, rect, left, top, right, bottom };
      }
    },
    []
  );

  /**
   * Scans a specific user-dragged marquee bounding box.
   */
  const scanCustomBox = async (
    image: HTMLImageElement,
    screenBox: { left: number; top: number; width: number; height: number }
  ) => {
    if (scanningRef.current || screenBox.width < 12 || screenBox.height < 12) return;
    setBusyImage(image);
    setError(null);
    setStatusMessage(t("ocr_recognizing"));
    capturingRef.current = true;
    scanningRef.current = true;
    window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } }));

    try {
      const { canvas, fullImage, source, rect } = await prepareImageCanvas(image);
      const imgRect = image.getBoundingClientRect();

      // Convert screen viewport box to canvas coordinates
      const scaleX = canvas.width / imgRect.width;
      const scaleY = canvas.height / imgRect.height;
      const cropX = Math.max(0, Math.floor((screenBox.left - imgRect.left) * scaleX));
      const cropY = Math.max(0, Math.floor((screenBox.top - imgRect.top) * scaleY));
      const cropW = Math.min(canvas.width - cropX, Math.ceil(screenBox.width * scaleX));
      const cropH = Math.min(canvas.height - cropY, Math.ceil(screenBox.height * scaleY));

      const { dataUrl: cropDataUrl } = cropCanvasRegion(
        canvas,
        { x: cropX, y: cropY, width: cropW, height: cropH },
        settings.ocrPreprocessEnabled !== false
      );

      const scanId = ++scanIdRef.current;
      const ocrResponse = await chrome.runtime.sendMessage({
        type: "RUN_MANGA_OCR",
        payload: {
          imageDataUrl: cropDataUrl,
          orientation: settings.ocrDefaultOrientation || "auto",
          boxWidth: cropW,
          boxHeight: cropH,
        },
      });

      if (ocrResponse?.type !== "MANGA_OCR_RESULT") {
        throw new Error(ocrResponse?.payload?.error || t("ocr_no_text"));
      }

      const result = ocrResponse.payload as OcrExecutionResult;
      const recognizedText = result.text?.trim() || "";
      if (!recognizedText) {
        throw new Error(t("ocr_no_text"));
      }

      const highlight: Highlight = {
        id: `${scanId}:custom`,
        imageUrl: cropDataUrl,
        text: recognizedText,
        x: (screenBox.left - imgRect.left) / imgRect.width,
        y: (screenBox.top - imgRect.top) / imgRect.height,
        width: screenBox.width / imgRect.width,
        height: screenBox.height / imgRect.height,
      };

      setScans((current) => [
        ...current.filter((scan) => scan.image !== image && scan.image.isConnected).slice(-19),
        { image, src: source, highlights: [highlight] },
      ]);

      // Immediately open analysis popup for the selected dialogue
      window.dispatchEvent(
        new CustomEvent("hakkutsu:analyze", {
          detail: {
            text: recognizedText,
            x: screenBox.left + screenBox.width / 2,
            y: screenBox.top + screenBox.height,
            mode: "dictionary",
            transient: false,
            imageUrl: cropDataUrl,
            pauseVideo: false,
            ocrRegionId: highlight.id,
          },
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      capturingRef.current = false;
      scanningRef.current = false;
      setBusyImage(null);
      setStatusMessage(null);
      setIsSelectingBox(false);
      setDragBox(null);
    }
  };

  /**
   * Automatic two-stage scan: Detects speech bubbles & text regions, crops them,
   * and runs PSM.SINGLE_BLOCK OCR in batch.
   */
  const scanImage = async (image: HTMLImageElement) => {
    if (scanningRef.current) return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    setBusyImage(image);
    setError(null);
    setStatusMessage(t("ocr_detecting"));
    capturingRef.current = true;
    scanningRef.current = true;
    window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } }));

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const { canvas, fullImage, source, left, top, right, bottom } = await prepareImageCanvas(image);

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not acquire 2D canvas context");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const scanId = ++scanIdRef.current;

      // Stage 1: Computer Vision Speech Bubble & Dialogue Detection
      const detectedRegions = detectMangaDialogueRegions(pixels, {
        minBubbleArea: 100,
        includeBorderlessText: true,
      });

      let highlights: Highlight[] = [];

      if (detectedRegions.length > 0) {
        // Stage 2: Adaptive Bubble Crop Recognition in Batch
        setStatusMessage(`${t("ocr_scanning")} (0/${detectedRegions.length})`);

        const crops: OcrCropItem[] = detectedRegions.map((region, index) => {
          const bw = region.bbox.x1 - region.bbox.x0;
          const bh = region.bbox.y1 - region.bbox.y0;
          const { canvas: cropCanvas, dataUrl } = cropCanvasRegion(
            canvas,
            { x: region.bbox.x0, y: region.bbox.y0, width: bw, height: bh },
            settings.ocrPreprocessEnabled !== false
          );
          return {
            id: `${scanId}:${index}`,
            dataUrl,
            width: cropCanvas.width,
            height: cropCanvas.height,
            orientation: region.orientation,
            bbox: region.bbox,
          };
        });

        const batchResponse = await chrome.runtime.sendMessage({
          type: "RUN_MANGA_OCR_BATCH",
          payload: { crops },
        });

        if (batchResponse?.type === "MANGA_OCR_BATCH_RESULT" && Array.isArray(batchResponse.payload)) {
          const results = batchResponse.payload as Array<{
            id: string;
            text: string;
            confidence: number;
            bbox: { x0: number; y0: number; x1: number; y1: number };
          }>;

          highlights = results
            .filter((item) => item.text && /[\u3040-\u30ff\u3400-\u9fff]/u.test(item.text))
            .map((item) => {
              const crop = crops.find((c) => c.id === item.id);
              const b = item.bbox;
              return {
                id: item.id,
                imageUrl: crop?.dataUrl || "",
                text: item.text,
                x: fullImage
                  ? b.x0 / canvas.width
                  : (left - rect.left + (b.x0 * (right - left)) / canvas.width) / rect.width,
                y: fullImage
                  ? b.y0 / canvas.height
                  : (top - rect.top + (b.y0 * (bottom - top)) / canvas.height) / rect.height,
                width: fullImage
                  ? (b.x1 - b.x0) / canvas.width
                  : ((b.x1 - b.x0) * (right - left)) / canvas.width / rect.width,
                height: fullImage
                  ? (b.y1 - b.y0) / canvas.height
                  : ((b.y1 - b.y0) * (bottom - top)) / canvas.height / rect.height,
              };
            });
        }
      }

      // Stage 3 Fallback: If bubble detection returned no regions, use full-page Tesseract
      if (highlights.length === 0) {
        setStatusMessage(t("ocr_recognizing"));
        const fullDataUrl = canvas.toDataURL("image/png");
        const ocrResponse = await chrome.runtime.sendMessage({
          type: "RUN_MANGA_OCR",
          payload: {
            imageDataUrl: fullDataUrl,
            orientation: settings.ocrDefaultOrientation || "auto",
            boxWidth: canvas.width,
            boxHeight: canvas.height,
          },
        });

        if (ocrResponse?.type === "MANGA_OCR_RESULT") {
          const fullResult = ocrResponse.payload as OcrExecutionResult;
          highlights = groupOcrRegions(fullResult.lines, { pixels }).map((region, index) => {
            const padding = Math.max(2, Math.min(region.bbox.x1 - region.bbox.x0, region.bbox.y1 - region.bbox.y0) * 0.08);
            const line = {
              ...region,
              bbox: {
                x0: Math.max(0, Math.floor(region.bbox.x0 - padding)),
                y0: Math.max(0, Math.floor(region.bbox.y0 - padding)),
                x1: Math.min(canvas.width, Math.ceil(region.bbox.x1 + padding)),
                y1: Math.min(canvas.height, Math.ceil(region.bbox.y1 + padding)),
              },
            };
            const cropW = line.bbox.x1 - line.bbox.x0;
            const cropH = line.bbox.y1 - line.bbox.y0;
            const { dataUrl: cropDataUrl } = cropCanvasRegion(canvas, {
              x: line.bbox.x0,
              y: line.bbox.y0,
              width: cropW,
              height: cropH,
            });
            return {
              id: `${scanId}:fallback:${index}`,
              imageUrl: cropDataUrl,
              text: line.text,
              x: fullImage ? line.bbox.x0 / canvas.width : (left - rect.left + (line.bbox.x0 * (right - left)) / canvas.width) / rect.width,
              y: fullImage ? line.bbox.y0 / canvas.height : (top - rect.top + (line.bbox.y0 * (bottom - top)) / canvas.height) / rect.height,
              width: fullImage ? cropW / canvas.width : (cropW * (right - left)) / canvas.width / rect.width,
              height: fullImage ? cropH / canvas.height : (cropH * (bottom - top)) / canvas.height / rect.height,
            };
          });
        }
      }

      if (highlights.length === 0) {
        throw new Error(t("ocr_no_text_hint"));
      }

      if (!image.isConnected || image.currentSrc !== source) return;
      setScans((current) => [
        ...current.filter((scan) => scan.image !== image && scan.image.isConnected).slice(-19),
        { image, src: source, highlights },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      capturingRef.current = false;
      scanningRef.current = false;
      setBusyImage(null);
      setStatusMessage(null);
    }
  };

  const imageRect = hoveredImage?.isConnected ? hoveredImage.getBoundingClientRect() : null;
  const showControls =
    imageRect &&
    imageRect.width > 0 &&
    imageRect.height > 0 &&
    imageRect.bottom > 0 &&
    imageRect.right > 0 &&
    imageRect.top < window.innerHeight &&
    imageRect.left < window.innerWidth;

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

  return (
    <>
      <style>{`
        .hk-manga-region {
          background: rgba(56, 189, 248, 0.08);
          border: 1.5px solid rgba(56, 189, 248, 0.65);
          box-shadow: 0 0 5px rgba(56, 189, 248, 0.35);
          transition: all 0.15s ease-in-out;
        }
        .hk-manga-region:hover, .hk-manga-region:focus-visible {
          background: rgba(56, 189, 248, 0.28);
          border-color: #38bdf8;
          outline: 2px solid #38bdf8;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
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
              background: error ? "#7f1d1d" : "#141418",
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
            onClick={() => setIsSelectingBox((prev) => !prev)}
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
          style={{
            position: "fixed",
            zIndex: 2147483646,
            pointerEvents: "none",
            top: Math.max(8, imageRect.top + 46),
            left: Math.max(8, Math.min(window.innerWidth - 300, imageRect.right - 300)),
            maxWidth: 290,
            padding: "7px 10px",
            borderRadius: 7,
            background: "#7f1d1d",
            color: "white",
            font: "12px system-ui",
            boxShadow: "0 4px 12px rgba(0,0,0,.6)",
            lineHeight: 1.4,
          }}
        >
          {error}
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
        scans.map((scan) => {
          if (!scan.image.isConnected || scan.image.currentSrc !== scan.src) return null;
          const rect = scan.image.getBoundingClientRect();
          return scan.highlights.map((highlight) => {
            const x = rect.left + highlight.x * rect.width;
            const y = rect.top + highlight.y * rect.height;
            const width = highlight.width * rect.width;
            const height = highlight.height * rect.height;
            if (x + width < 0 || y + height < 0 || x > window.innerWidth || y > window.innerHeight) return null;

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
                  position: "fixed",
                  zIndex: 2147483645,
                  pointerEvents: "auto",
                  cursor: "pointer",
                  left: x,
                  top: y,
                  width,
                  height,
                  minWidth: 8,
                  minHeight: 8,
                  padding: 0,
                  borderRadius: 4,
                  color: "transparent",
                }}
              />
            );
          });
        })}
    </>
  );
}
