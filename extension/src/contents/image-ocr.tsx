import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useCallback } from "react";
import type { TokenAnalysis } from "~types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = `
    .hk-image-analyze-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483646;
      background: rgba(9, 9, 11, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #f4f4f5;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      transition: all 0.2s ease;
      opacity: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .hk-image-container:hover .hk-image-analyze-btn {
      opacity: 1;
      pointer-events: auto;
    }
    
    .hk-image-analyze-btn:hover {
      background: rgba(9, 9, 11, 0.95);
      border-color: rgba(255, 255, 255, 0.3);
      transform: translateY(-1px);
    }
    
    .hk-image-analyze-btn:active {
      transform: translateY(0);
    }
    
    .hk-ocr-result-panel {
      position: absolute;
      background: rgba(9, 9, 11, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 12px 16px 16px;
      color: #f4f4f5;
      font-family: 'Inter', 'Noto Sans JP', sans-serif;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      min-width: 200px;
      max-width: 320px;
      cursor: default;
      backdrop-filter: blur(8px);
    }
    
    .hk-ocr-result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 600;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .hk-ocr-result-close {
      background: transparent;
      border: none;
      color: #a1a1aa;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }
    
    .hk-ocr-result-close:hover {
      color: white;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .hk-ocr-text {
      font-size: 16px;
      line-height: 1.6;
    }
    
    .hk-ocr-token {
      cursor: pointer;
      display: inline-block;
      padding: 0 1px;
      border-radius: 4px;
      transition: background 0.15s;
    }
    
    .hk-ocr-token:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    
    .hk-ocr-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #a1a1aa;
    }
    
    .hk-ocr-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: hk-ocr-spin 1s linear infinite;
    }
    
    @keyframes hk-ocr-spin {
      to { transform: rotate(360deg); }
    }
  `;
  return style;
};

const ImageOcr = () => {
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [activeImage, setActiveImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ text: string; tokens: TokenAnalysis[] | null } | null>(null);
  const [resultPosition, setResultPosition] = useState<{ x: number; y: number } | null>(null);

  // 1. Detect Images
  useEffect(() => {
    const findImages = () => {
      const imgs = Array.from(document.querySelectorAll("img")).filter(img => {
        const rect = img.getBoundingClientRect();
        return rect.width >= 100 && rect.height >= 100;
      });
      setImages(imgs);
    };

    findImages();
    
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) findImages();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    window.addEventListener("resize", findImages);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", findImages);
    };
  }, []);

  // Handle global escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOcrResult(null);
        setActiveImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleAnalyze = async (img: HTMLImageElement, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setActiveImage(img);
    setOcrResult(null);
    setLoading(true);

    const rect = img.getBoundingClientRect();
    setResultPosition({
      x: rect.right + 16,
      y: rect.top
    });

    try {
      // Create a canvas to extract image data safely
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");

      const settingsResult = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => resolve(res.payload));
      });
      const baseUrl = settingsResult.backendUrl || "http://localhost:8000";
      
      const res = await fetch(`${baseUrl}/api/v1/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_data: dataUrl,
          language: "jpn"
        })
      });
      
      if (!res.ok) throw new Error("OCR failed");
      const data = await res.json();
      
      if (data.full_text) {
        const analyzeMsg = await new Promise<any>(resolve => {
          chrome.runtime.sendMessage({ 
            type: "ANALYZE_TEXT", 
            payload: { text: data.full_text, include_definitions: false } 
          }, resolve);
        });

        let tokens = null;
        if (analyzeMsg?.type === "ANALYZE_RESULT") {
          tokens = analyzeMsg.payload.tokens;
        }

        setOcrResult({ text: data.full_text, tokens });
      } else {
        setOcrResult({ text: "Không tìm thấy văn bản", tokens: null });
      }
    } catch (err) {
      console.error(err);
      setOcrResult({ text: "Lỗi khi quét ảnh", tokens: null });
    } finally {
      setLoading(false);
    }
  };

  const handleTokenClick = (token: TokenAnalysis, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token.is_japanese) return;

    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: token.dictionary_form || token.surface,
          x: e.clientX,
          y: e.clientY,
        },
      })
    );

    chrome.runtime.sendMessage({
      type: "TEXT_SELECTED",
      payload: {
        text: token.dictionary_form || token.surface,
        context: ocrResult?.text,
        x: e.clientX,
        y: e.clientY,
        sourceUrl: window.location.href,
      },
    }).catch(() => {});
  };

  return (
    <>
      {images.map((img, i) => {
        const rect = img.getBoundingClientRect();
        // Ignore images that are not visible
        if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
          return null;
        }
        
        return (
          <div 
            key={`img-${i}`}
            className="hk-image-container"
            style={{
              position: 'absolute',
              top: rect.top + window.scrollY,
              left: rect.left + window.scrollX,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none', // Let clicks pass through to the image
              zIndex: 2147483645
            }}
          >
            <button 
              className="hk-image-analyze-btn"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => handleAnalyze(img, e)}
              title="Quét chữ trong ảnh"
            >
              <span>🔍</span> Analyze
            </button>
          </div>
        );
      })}

      {(loading || ocrResult) && activeImage && resultPosition && (
        <div 
          className="hk-ocr-result-panel"
          style={{
            // Adjust position so it doesn't overflow screen
            left: Math.min(resultPosition.x, window.innerWidth - 340),
            top: Math.max(16, Math.min(resultPosition.y, window.innerHeight - 200)),
            position: 'fixed'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="hk-ocr-result-header">
            <span>OCR Result</span>
            <button 
              className="hk-ocr-result-close"
              onClick={() => {
                setOcrResult(null);
                setActiveImage(null);
              }}
            >
              ✕
            </button>
          </div>
          
          {loading ? (
            <div className="hk-ocr-loading">
              <div className="hk-ocr-spinner" />
              Đang phân tích ảnh...
            </div>
          ) : (
            <div className="hk-ocr-text">
              {ocrResult?.tokens ? (
                ocrResult.tokens.map((token, i) => (
                  <span 
                    key={i} 
                    className="hk-ocr-token"
                    onClick={(e) => handleTokenClick(token, e)}
                  >
                    {token.surface}
                  </span>
                ))
              ) : (
                ocrResult?.text
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ImageOcr;
