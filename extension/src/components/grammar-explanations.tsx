import React from "react"
import type { GrammarPattern } from "~lib/types"

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
      <div className="hk-dict-label">
        Giải thích ngữ pháp
      </div>
      <div className="hk-grammar-items" style={{ display: "grid", gap: 8 }}>
        {patterns.map((pattern, index) => (
          <div
            key={`${pattern.pattern}-${index}`}
            className="hk-grammar-item-card"
          >
            <div
              className="hk-grammar-header"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span className="hk-grammar-pattern-text">
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
              style={{ marginTop: 5, color: "var(--hk-text-primary)", fontSize: 13 }}
            >
              {pattern.meaning}
            </div>
            {pattern.explanation !== pattern.meaning && (
              <div
                className="hk-grammar-explanation"
                style={{ marginTop: 4, color: "var(--hk-text-secondary)", fontSize: 12, lineHeight: 1.5 }}
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
