/**
 * Image Cropping and Pre-processing Service for Box OCR.
 *
 * Provides high-DPI coordinate cropping from viewport screenshots
 * and manga-optimized image filtering (grayscale, contrast boost, binarization).
 */

import type { BoxOcrCoordinates } from "~lib/utils/types";

export interface PreprocessOptions {
  grayscale?: boolean;
  enhanceContrast?: boolean;
  binarize?: boolean;
  threshold?: number; // 0-255, default: adaptive/Otsu
}

/**
 * Loads an image from a data URL into an HTMLImageElement.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image for cropping: ${err}`));
    img.src = dataUrl;
  });
}

/**
 * Applies manga pre-processing filters to image canvas pixel data.
 */
export function applyMangaPreprocess(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: PreprocessOptions = {}
): void {
  const {
    grayscale = true,
    enhanceContrast = true,
    binarize = false,
    threshold
  } = options;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const len = data.length;

  // 1. Grayscale & Contrast Analysis
  let minGray = 255;
  let maxGray = 0;
  const grayValues = new Uint8ClampedArray(len / 4);

  for (let i = 0, j = 0; i < len; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Standard Rec. 601 luma formula
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayValues[j] = gray;
    if (gray < minGray) minGray = gray;
    if (gray > maxGray) maxGray = gray;
  }

  // 2. Contrast Stretching / Histogram Normalization
  const contrastRange = maxGray - minGray;
  const needsStretch = enhanceContrast && contrastRange > 20 && contrastRange < 220;

  // 3. Otsu Threshold Calculation (if binarization requested or automatic)
  let computedThreshold = threshold ?? 128;
  if (binarize && threshold === undefined) {
    // Calculate Otsu threshold on grayscale histogram
    const histogram = new Array(256).fill(0);
    for (let j = 0; j < grayValues.length; j++) {
      histogram[grayValues[j]]++;
    }
    const total = grayValues.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        computedThreshold = t;
      }
    }
  }

  // 4. Apply transformations to image buffer
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    let gray = grayValues[j];

    // Contrast stretching
    if (needsStretch) {
      gray = Math.round(((gray - minGray) / contrastRange) * 255);
    }

    // Binarization (if active)
    if (binarize) {
      gray = gray >= computedThreshold ? 255 : 0;
    }

    if (grayscale || enhanceContrast || binarize) {
      data[i] = gray;     // R
      data[i + 1] = gray; // G
      data[i + 2] = gray; // B
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Crops a viewport screenshot to the specified bounding box coordinates.
 *
 * Maps CSS viewport coordinates onto the actual captured bitmap. This is more
 * reliable than devicePixelRatio alone because browser zoom and platform
 * screenshot behavior can change the bitmap scale independently.
 */
export async function cropViewportBox(
  fullScreenshotDataUrl: string,
  box: BoxOcrCoordinates,
  preprocess: boolean = true
): Promise<string> {
  const img = await loadImage(fullScreenshotDataUrl);

  // Safety checks on box dimensions
  const fallbackScale = box.dpr || (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
  const scaleX = box.viewportWidth && box.viewportWidth > 0
    ? img.naturalWidth / box.viewportWidth
    : fallbackScale;
  const scaleY = box.viewportHeight && box.viewportHeight > 0
    ? img.naturalHeight / box.viewportHeight
    : fallbackScale;
  const cropX = Math.min(img.naturalWidth, Math.max(0, Math.round(box.x * scaleX)));
  const cropY = Math.min(img.naturalHeight, Math.max(0, Math.round(box.y * scaleY)));
  const cropW = Math.min(Math.round(box.width * scaleX), img.naturalWidth - cropX);
  const cropH = Math.min(Math.round(box.height * scaleY), img.naturalHeight - cropY);

  if (cropW <= 0 || cropH <= 0) {
    throw new Error("Invalid crop dimensions (width or height is 0)");
  }

  // Create canvas for crop
  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not acquire 2D canvas context for cropping");
  }

  // Draw the cropped region
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Apply manga pre-processing if enabled
  if (preprocess) {
    applyMangaPreprocess(ctx, cropW, cropH, {
      grayscale: true,
      enhanceContrast: true,
      binarize: false, // Soft contrast boost preserves anti-aliased character edges better for Tesseract
    });
  }

  return canvas.toDataURL("image/png");
}
