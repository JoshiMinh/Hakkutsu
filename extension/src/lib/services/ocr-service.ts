import { createWorker } from "tesseract.js";

class LocalOcrService {
  private worker: any = null;

  private async loadWorker() {
    if (!this.worker) {
      this.worker = await createWorker(["jpn", "jpn_vert"]);
    }
    return this.worker;
  }

  async recognizeImage(dataUrl: string): Promise<string> {
    try {
      // 1. If running inside Service Worker with offscreen document API available
      if (typeof chrome !== "undefined" && chrome.offscreen?.createDocument) {
        return await this.recognizeViaOffscreen(dataUrl);
      }

      // 2. Direct Tesseract worker (content script or DOM window context)
      const worker = await this.loadWorker();
      const { data } = await worker.recognize(dataUrl);
      return (data.text || "").trim();
    } catch (e: any) {
      console.error("[LocalOcrService] OCR Error:", e);
      throw new Error(`Failed to recognize text: ${e?.message || e}`);
    }
  }

  private async recognizeViaOffscreen(dataUrl: string): Promise<string> {
    const offscreenUrl = chrome.runtime.getURL("offscreen.html");
    
    // Check if offscreen document exists
    if (typeof (chrome.runtime as any).getContexts === "function") {
      const existingContexts = await (chrome.runtime as any).getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      });
      if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["BLOBS" as any],
          justification: "Run Tesseract.js OCR in offscreen DOM environment for local Japanese text recognition",
        });
      }
    } else {
      try {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["BLOBS" as any],
          justification: "Run Tesseract.js OCR in offscreen DOM environment for local Japanese text recognition",
        });
      } catch (err: any) {
        // Document might already exist
        if (!err.message?.includes("Only a single offscreen document may be created")) {
          throw err;
        }
      }
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "RUN_OFFSCREEN_OCR", payload: { dataUrl } },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (response?.type === "OFFSCREEN_OCR_ERROR") {
            return reject(new Error(response.payload?.error || "Offscreen OCR error"));
          }
          resolve(response?.payload?.text || "");
        }
      );
    });
  }
}

export const localOcrService = new LocalOcrService();
