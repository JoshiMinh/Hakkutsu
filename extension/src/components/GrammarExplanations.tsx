import React from "react"
import type { GrammarPattern } from "../types/api"

interface GrammarExplanationsProps {
  patterns: GrammarPattern[]
}

export const GrammarExplanations: React.FC<GrammarExplanationsProps> = ({ patterns }) => {
  if (!patterns || patterns.length === 0) {
    return (
      <div
        className="hk-grammar-empty"
        style={{ marginTop: 12, color: "#94a3b8", fontSize: 12 }}
      >
        <p>Không phát hiện mẫu ngữ pháp nổi bật trong câu này.</p>
      </div>
    )
  }

  return (
    <div className="hk-grammar-list" style={{ marginTop: 16 }}>
      <h3
        className="hk-grammar-title"
        style={{ margin: "0 0 8px", color: "#e2e8f0", fontSize: 13 }}
      >
        Giải thích ngữ pháp
      </h3>
      <div className="hk-grammar-items" style={{ display: "grid", gap: 8 }}>
        {patterns.map((pattern, index) => (
          <div
            key={`${pattern.pattern}-${index}`}
            className="hk-grammar-item"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.045)",
              border: "1px solid rgba(148,163,184,0.18)",
            }}
          >
            <div
              className="hk-grammar-header"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                className="hk-grammar-pattern"
                style={{ color: "#fbbf24", fontSize: 15, fontWeight: 700 }}
              >
                {pattern.pattern}
              </span>
              {pattern.jlpt_level && (
                <span className={`hakkutsu-jlpt-badge jlpt-${pattern.jlpt_level.toLowerCase()}`}>
                  {pattern.jlpt_level}
                </span>
              )}
            </div>
            <div
              className="hk-grammar-meaning"
              style={{ marginTop: 5, color: "#f1f5f9", fontSize: 13 }}
            >
              {pattern.meaning}
            </div>
            {pattern.explanation !== pattern.meaning && (
              <div
                className="hk-grammar-explanation"
                style={{ marginTop: 4, color: "#cbd5e1", fontSize: 12, lineHeight: 1.5 }}
              >
                {pattern.explanation}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
