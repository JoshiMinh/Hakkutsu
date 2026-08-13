import { env, pipeline, type PipelineType } from "@xenova/transformers";

// Configure transformers.js for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;
// WebGPU is preferred if available, but WASM is fallback
env.backends.onnx.wasm.numThreads = 1; // Required for MV3 service workers

class LocalOcrService {
  private ocrPipeline: any = null;
  private detectorPipeline: any = null;
  private isLoaded = false;

  async loadModels() {
    if (this.isLoaded) return;
    try {
      // Load manga-ocr ONNX model (vision2seq)
      this.ocrPipeline = await pipeline("image-to-text", "onnx-community/manga-ocr-base-ONNX", {
        dtype: "q8"
      });
      // Optionally we could load a text detector model if needed. 
      // For basic usage where the user already cropped the image, 
      // we can just run MangaOCR on the cropped image directly.
      this.isLoaded = true;
    } catch (e) {
      console.error("Failed to load local OCR models:", e);
      throw e;
    }
  }

  async recognizeImage(dataUrl: string): Promise<string> {
    if (!this.isLoaded) {
      await this.loadModels();
    }
    
    // Convert dataUrl to blob/image for transformers.js
    // For service workers, we might need to pass the raw dataURL or fetch it
    const result = await this.ocrPipeline(dataUrl);
    
    // Result is usually an array of generated text
    if (Array.isArray(result) && result.length > 0) {
      return result[0].generated_text || result[0].text || "";
    }
    return "";
  }
}

export const localOcrService = new LocalOcrService();
