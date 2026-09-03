import React from "react"
import type { GrammarPattern } from "~lib/types"
import { useTranslation } from "~lib/languages/locales"
import { Sparkles } from "lucide-react"

interface GrammarExplanationsProps {
  patterns: GrammarPattern[]
}

export const GrammarExplanations: React.FC<GrammarExplanationsProps> = ({ patterns }) => {
  const { t } = useTranslation();

  if (!patterns || patterns.length === 0) {
    return (
      <div
        className="hk-grammar-empty"
        style={{ marginTop: 12, color: "#94a3b8", fontSize: 12 }}
      >
        <p>{t("dict_grammar_empty")}</p>
      </div>
    )
  }

  return (
    <div className="hk-grammar-list" style={{ marginTop: 16 }}>
      <div className="hk-dict-label" style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
        <Sparkles size={12} style={{ color: "#f59e0b" }} />
        {t("dict_grammar_title")}
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
