import { useEffect, useRef, useState } from "react";
import { Loader2, ScanText } from "lucide-react";
import { cropViewportBox } from "~lib/services/image-cropper";
import { containsJapanese } from "~lib/utils/japanese";
import { useSettingsStore } from "~lib/utils/settings";
import { useTranslation } from "~lib/locales";

type Highlight = { text: string; x: number; y: number; width: number; height: number };
type ScannedImage = { image: HTMLImageElement; src: string; highlights: Highlight[]; dataUrl: string };

export function MangaOcrImages() {
  const { settings } = useSettingsStore();
  const { t } = useTranslation();
  const [hoveredImage, setHoveredImage] = useState<HTMLImageElement | null>(null);
  const [scans, setScans] = useState<ScannedImage[]>([]);
  const [busyImage, setBusyImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLayoutVersion] = useState(0);
  const capturingRef = useRef(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (capturingRef.current) return;
      const target = event.target;
      if (target instanceof HTMLImageElement && target.isConnected) {
        setHoveredImage(target);
      } else if (!(event.composedPath() as EventTarget[]).some((item) =>
        item instanceof HTMLElement && item.dataset?.hakkutsuMangaOcr === "true"
      )) {
        setHoveredImage(null);
      }
    };
    const onLayout = () => setLayoutVersion((version) => version + 1);
    document.addEventListener("mousemove", onMove, true);
    window.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  }, []);

  const scanImage = async (image: HTMLImageElement) => {
    const rect = image.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return;

    setBusyImage(image);
    setError(null);
    capturingRef.current = true;
    window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss", { detail: { force: true } }));
    try {
      // The OCR button must leave the painted frame before screenshot capture.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const response = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (!response?.payload?.dataUrl) throw new Error(response?.payload?.error || "Could not capture image");
      const dataUrl = await cropViewportBox(response.payload.dataUrl, {
        x: left, y: top, width: right - left, height: bottom - top,
        dpr: window.devicePixelRatio, viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }, settings.ocrPreprocessEnabled !== false);
      const bitmap = new Image();
      bitmap.src = dataUrl;
      await bitmap.decode();
      const ocrResponse = await chrome.runtime.sendMessage({
        type: "RUN_MANGA_OCR",
        payload: {
          imageDataUrl: dataUrl,
          orientation: settings.ocrDefaultOrientation || "auto",
          boxWidth: right - left,
          boxHeight: bottom - top,
        },
      });
      if (ocrResponse?.type !== "MANGA_OCR_RESULT") {
        throw new Error(ocrResponse?.payload?.error || "Manga OCR failed");
      }
      const result = ocrResponse.payload as import("~lib/services/ocr-engine").OcrExecutionResult;
      const highlights = result.lines.filter((line) => containsJapanese(line.text)).map((line) => ({
        text: line.text,
        x: (left - rect.left + line.bbox.x0 * (right - left) / bitmap.naturalWidth) / rect.width,
        y: (top - rect.top + line.bbox.y0 * (bottom - top) / bitmap.naturalHeight) / rect.height,
        width: (line.bbox.x1 - line.bbox.x0) * (right - left) / bitmap.naturalWidth / rect.width,
        height: (line.bbox.y1 - line.bbox.y0) * (bottom - top) / bitmap.naturalHeight / rect.height,
      }));
      if (highlights.length === 0) throw new Error(t("ocr_no_text"));
      setScans((current) => [...current.filter((scan) => scan.image !== image), { image, src: image.currentSrc, highlights, dataUrl }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      capturingRef.current = false;
      setBusyImage(null);
    }
  };

  const imageRect = hoveredImage?.isConnected ? hoveredImage.getBoundingClientRect() : null;
  const showButton = imageRect && imageRect.width > 0 && imageRect.height > 0 &&
    imageRect.bottom > 0 && imageRect.right > 0 && imageRect.top < window.innerHeight && imageRect.left < window.innerWidth;

  return <>
    {showButton && !capturingRef.current && <button
      type="button"
      data-hakkutsu-manga-ocr="true"
      title={error || t("ocr_btn_trigger")}
      aria-label={t("ocr_btn_trigger")}
      onClick={() => hoveredImage && void scanImage(hoveredImage)}
      disabled={busyImage === hoveredImage}
      style={{
        position: "fixed", zIndex: 2147483646, pointerEvents: "auto", cursor: "pointer",
        top: Math.max(8, imageRect.top + 8), left: Math.max(8, Math.min(window.innerWidth - 132, imageRect.right - 120)),
        padding: "6px 9px", display: "flex", alignItems: "center", gap: 5,
        borderRadius: 7, border: "1px solid rgba(255,255,255,.35)",
        background: error ? "#7f1d1d" : "#141418", color: "white", font: "600 12px system-ui",
        boxShadow: "0 2px 10px rgba(0,0,0,.5)",
      }}
    >{busyImage === hoveredImage ? <Loader2 size={14} /> : <ScanText size={14} />}{t("ocr_btn_trigger")}</button>}
    {showButton && error && !capturingRef.current && <div style={{
      position: "fixed", zIndex: 2147483646, pointerEvents: "none",
      top: Math.max(8, imageRect.top + 42), left: Math.max(8, Math.min(window.innerWidth - 270, imageRect.right - 270)),
      maxWidth: 260, padding: "6px 8px", borderRadius: 6,
      background: "#7f1d1d", color: "white", font: "12px system-ui",
    }}>{error}</div>}
    {!capturingRef.current && scans.map((scan, imageIndex) => {
      if (!scan.image.isConnected || scan.image.currentSrc !== scan.src) return null;
      const rect = scan.image.getBoundingClientRect();
      return scan.highlights.map((highlight, index) => {
        const x = rect.left + highlight.x * rect.width;
        const y = rect.top + highlight.y * rect.height;
        const width = highlight.width * rect.width;
        const height = highlight.height * rect.height;
        if (x + width < 0 || y + height < 0 || x > window.innerWidth || y > window.innerHeight) return null;
        return <button
          key={`${imageIndex}-${index}`}
          type="button"
          data-hakkutsu-manga-ocr="true"
          aria-label={highlight.text}
          title={highlight.text}
          onMouseEnter={() => window.dispatchEvent(new CustomEvent("hakkutsu:analyze", {
            detail: { text: highlight.text, x, y: y + height, mode: "dictionary", transient: true, imageUrl: scan.dataUrl, pauseVideo: false },
          }))}
          onMouseLeave={() => window.setTimeout(() => window.dispatchEvent(new CustomEvent("hakkutsu:analysis-dismiss")), 250)}
          style={{
            position: "fixed", zIndex: 2147483645, pointerEvents: "auto", cursor: "help",
            left: x, top: y, width, height, minWidth: 8, minHeight: 8, padding: 0,
            border: "1px solid rgba(56,189,248,.85)", borderRadius: 3,
            background: "rgba(56,189,248,.22)", color: "transparent",
          }}
        />;
      });
    })}
  </>;
}
