import React from "react"
import type { GrammarPattern } from "../types/api"

interface GrammarExplanationsProps {
  patterns: GrammarPattern[]
}

export const GrammarExplanations: React.FC<GrammarExplanationsProps> = ({ patterns }) => {
  if (!patterns || patterns.length === 0) {
    return (
      <div className="hakkutsu-grammar-empty">
        <p>No specific grammar patterns detected in this sentence.</p>
      </div>
    )
  }

  return (
    <div className="hakkutsu-grammar-list">
      <h3 className="hakkutsu-grammar-title">Grammar Patterns</h3>
      <div className="hakkutsu-grammar-items">
        {patterns.map((pattern, index) => (
          <div key={`${pattern.pattern}-${index}`} className="hakkutsu-grammar-item">
            <div className="hakkutsu-grammar-header">
              <span className="hakkutsu-grammar-pattern">{pattern.pattern}</span>
              {pattern.jlpt_level && (
                <span className={`hakkutsu-jlpt-badge jlpt-${pattern.jlpt_level.toLowerCase()}`}>
                  {pattern.jlpt_level}
                </span>
              )}
            </div>
            <div className="hakkutsu-grammar-meaning">{pattern.meaning}</div>
            <div className="hakkutsu-grammar-explanation">{pattern.explanation}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
