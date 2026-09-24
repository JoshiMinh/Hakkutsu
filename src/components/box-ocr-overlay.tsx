import React, { useState, useEffect, useRef, useCallback } from "react";
import { Crop, Sparkles, X, ArrowDownUp, ArrowLeftRight } from "lucide-react";
import type { BoxOcrCoordinates } from "~lib/utils/types";

interface BoxOcrOverlayProps {
  onComplete: (box: BoxOcrCoordinates, orientation: "auto" | "vertical" | "horizontal") => void;
  onCancel: () => void;
}

export const BoxOcrOverlay: React.FC<BoxOcrOverlayProps> = ({ onComplete, onCancel }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);
  const [orientationMode, setOrientationMode] = useState<"auto" | "vertical" | "horizontal">("auto");
  const overlayRef = useRef<HTMLDivElement>(null);

  // Compute normalized bounding rectangle
  const getSelectionRect = useCallback(() => {
    if (!startPoint || !currentPoint) return null;
    const x = Math.min(startPoint.x, currentPoint.x);
    const y = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);
    return { x, y, width, height };
  }, [startPoint, currentPoint]);

  const rect = getSelectionRect();

  // Determine detected orientation based on aspect ratio
  const detectedOrientation = rect
    ? orientationMode === "auto"
      ? rect.height > rect.width * 1.15
        ? "vertical"
        : "horizontal"
      : orientationMode
    : "horizontal";

  // Handle keyboard shortcuts (Escape to cancel, Space or O to toggle orientation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === " " || e.key.toLowerCase() === "o") {
        e.preventDefault();
        setOrientationMode((prev) =>
          prev === "auto" ? "vertical" : prev === "vertical" ? "horizontal" : "auto"
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onCancel]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Left click only
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setStartPoint({ x: e.clientX, y: e.clientY });
    setCurrentPoint({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setCurrentPoint({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);

    if (rect && rect.width >= 12 && rect.height >= 12) {
      onComplete(
        {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          dpr: window.devicePixelRatio || 1,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
        orientationMode
      );
    } else {
      // Reset if selection was just a tiny click
      setStartPoint(null);
      setCurrentPoint(null);
    }
  };

  return (
    <div
      ref={overlayRef}
      id="hakkutsu-box-ocr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Hakkutsu Box OCR selection"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        cursor: "crosshair",
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        userSelect: "none",
        WebkitUserSelect: "none",
        backdropFilter: "blur(1px)",
      }}
    >
      {/* Top Banner Guide */}
      <div
        style={{
          position: "fixed",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          backgroundColor: "rgba(20, 24, 39, 0.92)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "9999px",
          padding: "8px 18px",
          color: "#f8fafc",
          fontSize: "13px",
          fontWeight: 500,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8" }}>
          <Crop size={16} />
          <span>Hakkutsu Box OCR</span>
        </div>
        <div style={{ width: "1px", height: "14px", backgroundColor: "rgba(255, 255, 255, 0.2)" }} />
        <span style={{ color: "#94a3b8" }}>
          Drag a box over manga text • <kbd style={{ padding: "1px 5px", borderRadius: "4px", background: "rgba(255,255,255,0.1)", fontSize: "11px" }}>Esc</kbd> Cancel
        </span>
        <button
          type="button"
          aria-label="Change text orientation"
          onClick={(e) => {
            e.stopPropagation();
            setOrientationMode((prev) =>
              prev === "auto" ? "vertical" : prev === "vertical" ? "horizontal" : "auto"
            );
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            background: "rgba(56, 189, 248, 0.15)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            borderRadius: "6px",
            padding: "2px 8px",
            color: "#38bdf8",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          {orientationMode === "vertical" ? (
            <>
              <ArrowDownUp size={12} />
              <span>Vertical (縦書き)</span>
            </>
          ) : orientationMode === "horizontal" ? (
            <>
              <ArrowLeftRight size={12} />
              <span>Horizontal (横書き)</span>
            </>
          ) : (
            <>
              <Sparkles size={12} />
              <span>Auto ({detectedOrientation})</span>
            </>
          )}
        </button>
        <button
          type="button"
          aria-label="Cancel OCR selection"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            padding: "2px",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Selected Bounding Box Cutout */}
      {rect && rect.width > 0 && rect.height > 0 && (
        <div
          style={{
            position: "fixed",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            boxSizing: "border-box",
            border: "2px solid #38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 15px rgba(56, 189, 248, 0.5)",
            pointerEvents: "none",
          }}
        >
          {/* Dimension & Orientation Pill attached to Box */}
          <div
            style={{
              position: "absolute",
              bottom: rect.y + rect.height + 28 > window.innerHeight ? "auto" : "-26px",
              top: rect.y + rect.height + 28 > window.innerHeight ? "-26px" : "auto",
              left: "0",
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              color: "#38bdf8",
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "4px",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              whiteSpace: "nowrap",
            }}
          >
            <span>
              {Math.round(rect.width)} × {Math.round(rect.height)}px
            </span>
            <span>•</span>
            <span>{detectedOrientation === "vertical" ? "縦書き (Vert)" : "横書き (Horiz)"}</span>
          </div>
        </div>
      )}
    </div>
  );
};
