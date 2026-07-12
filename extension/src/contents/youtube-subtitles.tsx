import type { PlasmoCSConfig, PlasmoGetOverlayAnchor } from "plasmo";
import { useEffect, useState, useRef } from "react";
import type { SubtitleResponse, SubtitleSegment, AnalyzeResponse } from "~types";

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
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchSubtitles = async () => {
      try {
        setSubtitles(null);
        setCurrentSegment(null);
        const response = await chrome.runtime.sendMessage({
          type: "GET_SUBTITLES",
          payload: { video_url: currentUrl },
        });
        if (response?.type === "ERROR") {
          throw new Error(response.payload.error);
        }
        if (response?.type === "SUBTITLES_RESULT") {
          setSubtitles(response.payload as SubtitleResponse);
        } else {
          throw new Error("Invalid response");
        }
      } catch (err) {
        console.error("Hakkutsu: Failed to fetch subtitles", err);
        setError("Failed to load subtitles");
      }
    };

    if (currentUrl.includes("watch")) {
      fetchSubtitles();
    }
  }, [currentUrl]);

  useEffect(() => {
    const video = document.querySelector("video");
    if (!video) return;
    videoRef.current = video;

    const handleTimeUpdate = () => {
      if (!subtitles) return;
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
  }, [subtitles]);

  // Fetch analysis for the current segment when it changes
  useEffect(() => {
    if (currentSegment) {
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
  }, [currentSegment]);

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

  if (error || !subtitles || !currentSegment) return null;

  return (
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
  );
};

export default YouTubeSubtitles;
