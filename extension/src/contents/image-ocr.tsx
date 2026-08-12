import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import { useEffect, useState, useCallback } from "react";
import { Scan, Paintbrush, X, Layers, Download, Copy, Check, Sparkles, RefreshCw, Languages, AlertCircle } from "lucide-react";
import type { TokenAnalysis } from "~types";
import cssText from "data-text:~style.css";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText + `
    .hk-image-actions-bar {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483646;
      display: flex;
      gap: 6px;
      opacity: 0;
      pointer-events: none;
      transition: all 0.2s ease;
    }
    
    .hk-image-container:hover .hk-image-actions-bar {
      opacity: 1;
      pointer-events: auto;
    }
    
    .hk-img-btn {
      background: rgba(18, 18, 20, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fafafa;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--hk-font-sans, system-ui, sans-serif);
      cursor: pointer;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    
    .hk-img-btn:hover {
      background: #27272a;
      border-color: rgba(255, 255, 255, 0.4);
      transform: translateY(-1px);
      color: #c084fc;
    }
    
    .hk-img-btn--primary {
      background: #9333ea;
      border-color: #a855f7;
    }
    
    .hk-img-btn--primary:hover {
      background: #a855f7;
      color: #fff;
    }

    .hk-ocr-result-panel {
      position: fixed;
      background: #121214;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 14px 16px;
      color: #f4f4f5;
      font-family: var(--hk-font-sans, system-ui, sans-serif);
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08);
      z-index: 2147483647;
      width: 400px;
      max-width: calc(100vw - 32px);
      cursor: default;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .hk-ocr-result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 13px;
      font-weight: 600;
    }
    
    .hk-ocr-text {
      font-family: var(--hk-font-jp, "Noto Sans JP", sans-serif);
      font-size: 15px;
      line-height: 1.6;
      background: #18181b;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      word-break: break-word;
    }
    
    .hk-ocr-token {
      cursor: pointer;
      display: inline-block;
      padding: 1px 2px;
      border-radius: 4px;
      transition: background 0.15s;
    }
    
    .hk-ocr-token:hover {
      background: rgba(168, 85, 247, 0.3);
      color: #f3e8ff;
    }
  `;
  return style;
};

const ImageOcr = () => {
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [activeImage, setActiveImage] = useState<HTMLImageElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transLoading, setTransLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [tokens, setTokens] = useState<TokenAnalysis[] | null>(null);
  const [translation, setTranslation] = useState<string>("");
  const [resultPosition, setResultPosition] = useState<{ x: number; y: number }>({ x: 20, y: 20 });
  const [copied, setCopied] = useState(false);

  // Detect Images
  useEffect(() => {
    const findImages = () => {
      const imgs = Array.from(document.querySelectorAll("img")).filter(img => {
        const rect = img.getBoundingClientRect();
        return rect.width >= 80 && rect.height >= 80;
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
        setIsOpen(false);
        setActiveImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const getImageDataUrl = async (img: HTMLImageElement): Promise<string> => {
    // Strategy 1: Try local direct canvas
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      // Canvas was tainted (cross-origin image)
    }

    // Strategy 2: Try fetching via extension background
    try {
      const fetchResult = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "FETCH_IMAGE", payload: { url: img.src || img.currentSrc } }, (res) => {
          if (res?.type === "ERROR") reject(new Error(res.payload.error));
          else resolve(res?.payload);
        });
      });
      if (fetchResult?.dataUrl) {
        return fetchResult.dataUrl;
      }
    } catch {
      // Background fetch failed (e.g. 403 referrer protection)
    }

    // Strategy 3 (Guaranteed Fallback): Screen capture crop of visible image
    return new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }, async (res) => {
        if (res?.type !== "SCREENSHOT_RESULT" || !res.payload?.dataUrl) {
          return reject(new Error("Không thể chụp ảnh màn hình"));
        }
        try {
          const rect = img.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const bgImg = new Image();
          bgImg.src = res.payload.dataUrl;
          await new Promise(r => bgImg.onload = r);

          const canvas = document.createElement("canvas");
          const cropX = Math.max(0, rect.left * dpr);
          const cropY = Math.max(0, rect.top * dpr);
          const cropW = Math.min(bgImg.width - cropX, rect.width * dpr);
          const cropH = Math.min(bgImg.height - cropY, rect.height * dpr);

          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bgImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(canvas.toDataURL("image/png"));
        } catch (cErr) {
          reject(cErr);
        }
      });
    });
  };

  const calculateOptimalPosition = (rect: DOMRect) => {
    const panelWidth = 400;
    const panelHeight = 350;
    let x = rect.right + 16;
    let y = rect.top;

    // If overflowing right edge, place on the left or top-left of image
    if (x + panelWidth > window.innerWidth - 16) {
      if (rect.left - panelWidth - 16 > 16) {
        x = rect.left - panelWidth - 16;
      } else {
        x = Math.max(16, window.innerWidth - panelWidth - 16);
      }
    }
    // Clamp Y inside viewport
    y = Math.max(16, Math.min(window.innerHeight - panelHeight - 16, y));
    return { x, y };
  };

  const handleAnalyze = async (img: HTMLImageElement, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setActiveImage(img);
    setIsOpen(true);
    setOcrText("");
    setTranslation("");
    setTokens(null);
    setError(null);
    setLoading(true);

    const rect = img.getBoundingClientRect();
    setResultPosition(calculateOptimalPosition(rect));

    try {
      const dataUrl = await getImageDataUrl(img);
      const settingsResult = await new Promise<any>(resolve => {
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => resolve(res?.payload));
      });
      const baseUrl = settingsResult?.backendUrl || "http://localhost:8000";
      
      const res = await fetch(`${baseUrl}/api/v1/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data: dataUrl, language: "jpn" })
      });
      
      if (!res.ok) throw new Error(`Lỗi máy chủ OCR (${res.status})`);
      const data = await res.json();
      const text = data.full_text || "";
      
      if (!text) {
        setOcrText("Không tìm thấy văn bản tiếng Nhật trong ảnh này.");
      } else {
        setOcrText(text);
        setTokens(data.tokens || null);

        // Fetch translation
        setTransLoading(true);
        try {
          const transRes = await fetch(`${baseUrl}/api/v1/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: [text], page_url: window.location.href, page_title: document.title })
          });
          if (transRes.ok) {
            const transData = await transRes.json();
            setTranslation(transData.translations?.[0] || transData.items?.[0]?.translation || "");
          }
        } catch (tErr) {
          console.error("Translation error", tErr);
        } finally {
          setTransLoading(false);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Lỗi khi quét ảnh");
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
  };

  const handleCopy = () => {
    if (!ocrText) return;
    navigator.clipboard.writeText(ocrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {images.map((img, i) => {
        const rect = img.getBoundingClientRect();
        if (rect.width < 60 || rect.height < 60) return null;
        
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
              pointerEvents: 'none',
              zIndex: 2147483645
            }}
          >
            <div className="hk-image-actions-bar">
              <button 
                className="hk-img-btn"
                style={{ pointerEvents: 'auto' }}
                onClick={(e) => handleAnalyze(img, e)}
                title="Quét chữ & dịch nghĩa"
              >
                <Languages size={14} /> Dịch
              </button>
            </div>
          </div>
        );
      })}

      {isOpen && activeImage && (
        <div 
          className="hk-ocr-result-panel"
          style={{
            left: resultPosition.x,
            top: resultPosition.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="hk-ocr-result-header">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={15} color="#c084fc" />
              <span>Nhận diện & Dịch</span>
            </div>
            <button 
              className="hk-btn hk-btn--ghost"
              style={{ padding: "2px 4px", border: "none", background: "transparent", color: "#a1a1aa", cursor: "pointer" }}
              onClick={() => {
                setIsOpen(false);
                setActiveImage(null);
              }}
            >
              <X size={16} />
            </button>
          </div>
          
          {loading ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#a1a1aa" }}>
              <RefreshCw size={24} className="hk-spin" style={{ color: "#a855f7", margin: "0 auto 8px" }} />
              <div>Đang nhận diện ký tự tiếng Nhật...</div>
            </div>
          ) : error ? (
            <div style={{ padding: "16px 0", color: "#f87171", display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          ) : (
            <>

              {ocrText && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase" }}>Văn bản gốc</span>
                    <button 
                      className="hk-img-btn" 
                      style={{ padding: "2px 6px", fontSize: "11px" }}
                      onClick={handleCopy}
                    >
                      {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                      {copied ? "Đã chép" : "Chép"}
                    </button>
                  </div>
                  <div className="hk-ocr-text">
                    {tokens && tokens.length > 0 ? (
                      tokens.map((token, i) => (
                        <span 
                          key={i} 
                          className="hk-ocr-token"
                          onClick={(e) => handleTokenClick(token, e)}
                          title={typeof token.reading === "string" ? token.reading : (token.reading?.hiragana || token.surface)}
                        >
                          {token.surface}
                        </span>
                      ))
                    ) : (
                      ocrText
                    )}
                  </div>
                </div>
              )}

              {transLoading ? (
                <div style={{ background: "rgba(20, 184, 166, 0.1)", borderLeft: "3px solid #14b8a6", padding: "8px 12px", borderRadius: "6px", fontSize: "13px", color: "#ccfbf1", display: "flex", alignItems: "center", gap: "8px" }}>
                  <RefreshCw size={13} className="hk-spin" />
                  <span>Đang dịch với Gemini...</span>
                </div>
              ) : translation ? (
                <div style={{ background: "rgba(20, 184, 166, 0.1)", borderLeft: "3px solid #14b8a6", padding: "8px 12px", borderRadius: "6px", fontSize: "13px", color: "#ccfbf1" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#14b8a6", marginBottom: "2px" }}>BẢN DỊCH</div>
                  {translation}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default ImageOcr;
