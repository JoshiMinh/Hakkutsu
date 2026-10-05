import { getSettings } from "~/features/settings/settings-storage";
import type { ExtensionMessage } from "~/shared/browser/messages";

let creatingOcrDocument: Promise<void> | null = null;

async function ensureOcrDocument(): Promise<void> {
  if (!chrome.offscreen || !chrome.runtime.getContexts) {
    throw new Error("Manga OCR requires Chrome's offscreen document API");
  }
  const documentUrl = chrome.runtime.getURL("ocr.html");
  const contexts = await new Promise<chrome.runtime.ExtensionContext[]>(
    (resolve, reject) => {
      chrome.runtime.getContexts(
        {
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          documentUrls: [documentUrl],
        },
        (found) => {
          const error = chrome.runtime.lastError;
          if (error)
            reject(
              new Error(
                error.message || "Could not inspect extension contexts",
              ),
            );
          else resolve(found);
        },
      );
    },
  );
  if (contexts.length > 0) return;

  if (!creatingOcrDocument) {
    creatingOcrDocument = chrome.offscreen
      .createDocument({
        url: "ocr.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          "Recognize Japanese text in images using the packaged Tesseract worker",
      })
      .finally(() => {
        creatingOcrDocument = null;
      });
  }
  await creatingOcrDocument;
}

export async function handleOcrMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case "RUN_MANGA_OCR": {
      if ((await getSettings()).mangaOcrEnabled === false) {
        return {
          type: "ERROR",
          payload: { error: "Manga OCR is disabled in settings." },
        };
      }
      const payload = message.payload as
        | {
            imageDataUrl: string;
            orientation?: "auto" | "vertical" | "horizontal";
            boxWidth?: number;
            boxHeight?: number;
          }
        | undefined;
      if (!payload?.imageDataUrl) {
        return { type: "ERROR", payload: { error: "Missing OCR image" } };
      }
      if (!chrome.offscreen?.createDocument && typeof Worker !== "undefined") {
        const { ocrEngine } = await import("~/features/ocr/ocr-engine");
        const result = await ocrEngine.recognize(payload.imageDataUrl, payload);
        return { type: "MANGA_OCR_RESULT", payload: result };
      }
      await ensureOcrDocument();
      return chrome.runtime.sendMessage({
        type: "RUN_MANGA_OCR_OFFSCREEN",
        payload,
      });
    }

    case "RUN_MANGA_OCR_BATCH": {
      if ((await getSettings()).mangaOcrEnabled === false) {
        return {
          type: "ERROR",
          payload: { error: "Manga OCR is disabled in settings." },
        };
      }
      const payload = message.payload as
        | {
            crops: Array<import("~/features/ocr/ocr-engine").OcrCropItem>;
          }
        | undefined;
      if (!payload?.crops || !Array.isArray(payload.crops)) {
        return { type: "ERROR", payload: { error: "Missing OCR crops" } };
      }
      if (!chrome.offscreen?.createDocument && typeof Worker !== "undefined") {
        const { ocrEngine } = await import("~/features/ocr/ocr-engine");
        const results = await ocrEngine.recognizeBatch(payload.crops);
        return { type: "MANGA_OCR_BATCH_RESULT", payload: results };
      }
      await ensureOcrDocument();
      return chrome.runtime.sendMessage({
        type: "RUN_MANGA_OCR_BATCH_OFFSCREEN",
        payload,
      });
    }

    case "CAPTURE_SCREENSHOT": {
      return new Promise((resolve, reject) => {
        const windowId = sender?.tab?.windowId;
        const callback = (dataUrl: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve({ type: "SCREENSHOT_RESULT", payload: { dataUrl } });
          }
        };
        const options: chrome.tabs.CaptureVisibleTabOptions = { format: "png" };
        if (windowId !== undefined) {
          chrome.tabs.captureVisibleTab(windowId, options, callback);
        } else {
          chrome.tabs.captureVisibleTab(options, callback);
        }
      });
    }
    default:
      return {
        type: "ERROR",
        payload: { error: `Unknown message type: ${message.type}` },
      };
  }
}
