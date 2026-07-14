import type { PlasmoCSConfig, PlasmoGetOverlayAnchor } from "plasmo";
import { useEffect, useState, useRef } from "react";
import type { SubtitleResponse, SubtitleSegment, AnalyzeResponse } from "~types";
import { YoutubeTranscript } from "youtube-transcript";

export const config: PlasmoCSConfig = {
  matches: ["https://www.youtube.com/watch*"],
};

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.querySelector("#movie_player") || document.querySelector(".html5-video-player");

const YouTubeSubtitles = () => {
  const [subtitles, setSubtitles] = useState<SubtitleResponse | null>(null);
  const [currentSegment, setCurrentSegment] = useState<SubtitleSegment | null>(null);
  const [analyzedSegment, setAnalyzedSegment] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // Store the current URL to detect navigation within the SPA
  const [currentUrl, setCurrentUrl] = useState(window.location.href);

  // Handle YouTube SPA navigation
  useEffect(() => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (lastUrl.includes("watch")) {
          setCurrentUrl(lastUrl);
        } else {
          setSubtitles(null);
          setCurrentSegment(null);
          setIsEnabled(false);
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  const fetchSubtitles = async () => {
    try {
      setLoading(true);
      setError(null);
      setSubtitles(null);
      setCurrentSegment(null);
      
      // Try fetching Japanese subtitles natively in the browser
      let transcripts;
      try {
        transcripts = await YoutubeTranscript.fetchTranscript(currentUrl, { lang: "ja" });
      } catch (err: any) {
        // If exact 'ja' fails, try fetching default and see if it's Japanese, 
        // or just let it fail and tell the user.
        throw new Error(err.message || "Japanese subtitles not found");
      }
      
      if (!transcripts || transcripts.length === 0) {
        throw new Error("No Japanese subtitles found");
      }

      const segments: SubtitleSegment[] = transcripts.map(t => ({
        text: t.text,
        start: t.offset / 1000,
        duration: t.duration / 1000
      }));

      const full_text = segments.map(s => s.text).join(" ");
      
      setSubtitles({
        video_id: new URL(currentUrl).searchParams.get("v") || "",
        language: "ja",
        segments,
        full_text
      });
    } catch (err: any) {
      console.error("Hakkutsu: Failed to fetch subtitles", err);
      setError(err.message || "Failed to load subtitles");
      setIsEnabled(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isEnabled && !subtitles && currentUrl.includes("watch")) {
      fetchSubtitles();
    }
  }, [isEnabled, currentUrl]);

  useEffect(() => {
    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const handleTimeUpdate = () => {
      if (!subtitles || !isEnabled) return;
      const currentTime = video.currentTime;
      
      const segment = subtitles.segments.find(
        (seg) => currentTime >= seg.start && currentTime <= seg.start + seg.duration
      );

      // Only update state if the segment changed to avoid infinite loops
      setCurrentSegment((prev) => (prev?.text === segment?.text ? prev : segment || null));
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [subtitles, isEnabled]);

  // Fetch analysis for the current segment when it changes
  useEffect(() => {
    if (currentSegment && isEnabled) {
      chrome.runtime.sendMessage({
        type: "ANALYZE_TEXT",
        payload: { text: currentSegment.text, include_definitions: false },
      })
        .then((response) => {
          if (response?.type === "ANALYZE_RESULT") {
            setAnalyzedSegment(response.payload as AnalyzeResponse);
          } else {
            console.error("Failed to analyze segment:", response?.payload?.error);
            setAnalyzedSegment(null);
          }
        })
        .catch((err) => {
          console.error("Hakkutsu background fetch error:", err);
          setAnalyzedSegment(null);
        });
    } else {
      setAnalyzedSegment(null);
    }
  }, [currentSegment, isEnabled]);

  const getSelection = () => {
    if (!containerRef.current) return window.getSelection();
    const root = containerRef.current.getRootNode() as any;
    return root.getSelection ? root.getSelection() : window.getSelection();
  };

  const handleMouseEnter = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  };

  const handleMouseLeave = () => {
    const selection = getSelection();
    // Don't auto-resume if the user has highlighted text
    if (selection && !selection.isCollapsed) return;

    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play();
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Prevent YouTube's player from pausing/playing the video when clicking subtitles
    e.stopPropagation();

    const selection = getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Trigger the inline dictionary overlay
    window.dispatchEvent(
      new CustomEvent("hakkutsu:analyze", {
        detail: {
          text: selectedText,
          x: e.clientX,
          y: e.clientY,
        },
      })
    );

    // Send selection to background script for Hakkutsu popup
    chrome.runtime.sendMessage({
      type: "TEXT_SELECTED",
      payload: {
        text: selectedText,
        context: currentSegment?.text,
        x: e.clientX,
        y: e.clientY,
        sourceUrl: window.location.href,
      },
    }).catch(() => {});
  };

  return (
    <>
      {/* Hakkutsu Toggle Switch */}
      <div style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        zIndex: 9999,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(0, 0, 0, 0.6)",
        padding: "8px 12px",
        borderRadius: "8px",
        fontFamily: "var(--hk-font-jp, sans-serif)",
        color: "white",
        backdropFilter: "blur(4px)"
      }}>
        <div style={{ fontSize: "14px", fontWeight: "bold" }}>
          Hakkutsu
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEnabled(!isEnabled);
            setError(null);
          }}
          style={{
            background: isEnabled ? "var(--hk-accent-crimson, #e85d75)" : "#4b5563",
            border: "none",
            borderRadius: "12px",
            width: "40px",
            height: "24px",
            position: "relative",
            cursor: "pointer",
            transition: "background 0.2s"
          }}
        >
          <div style={{
            position: "absolute",
            top: "2px",
            left: isEnabled ? "18px" : "2px",
            width: "20px",
            height: "20px",
            background: "white",
            borderRadius: "50%",
            transition: "left 0.2s"
          }} />
        </button>
        {loading && <span style={{ fontSize: "12px", marginLeft: "4px" }}>Loading...</span>}
        {error && <span style={{ fontSize: "12px", color: "#fca5a5", marginLeft: "4px", maxWidth: "150px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={error}>{error}</span>}
      </div>

      {/* Subtitle Display */}
      {isEnabled && subtitles && currentSegment && (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        bottom: "60px",
        left: "50%",
        transform: "translateX(-50%)",
        textAlign: "center",
        zIndex: 9999,
        width: "80%",
        pointerEvents: "auto",
      }}
      onMouseUp={handleMouseUp}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "inline-block",
          background: "rgba(0, 0, 0, 0.75)",
          color: "white",
          padding: "8px 16px",
          borderRadius: "8px",
          fontSize: "24px",
          fontFamily: "var(--hk-font-jp, sans-serif)",
          cursor: "text",
          transition: "background 0.2s ease",
          boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
          lineHeight: "1.5",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {analyzedSegment ? (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "2px" }}>
            {analyzedSegment.tokens.map((token, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  margin: "0 2px",
                  cursor: "pointer",
                }}
                title={token.is_japanese ? `${token.dictionary_form} — ${token.pos}` : token.surface}
              >
                {token.is_japanese && token.reading.hiragana !== token.surface ? (
                  <span style={{ fontSize: "0.5em", opacity: 0.8, marginBottom: "-4px" }}>
                    {token.reading.hiragana}
                  </span>
                ) : (
                  <span style={{ fontSize: "0.5em", opacity: 0 }}>&nbsp;</span>
                )}
                <span>{token.surface}</span>
              </span>
            ))}
          </div>
        ) : (
          currentSegment.text
        )}
      </div>
    </div>
      )}
    </>
  );
};

export default YouTubeSubtitles;
