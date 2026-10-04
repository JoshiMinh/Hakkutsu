import type { TokenAnalysis } from "~lib/utils/types";
import { hasKanji, distributeFurigana } from "~lib/utils/japanese";

export function TokenDisplay({
  tokens,
  selectedIndex,
  onSelect,
  variant = "chips",
}: {
  tokens: TokenAnalysis[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  variant?: "chips" | "sentence";
}) {
  return (
    <div className={`hk-tokens ${variant === "sentence" ? "hk-tokens--sentence" : ""}`} lang="ja">
      {tokens.map((token, i) => {
        const readingStr = typeof token.reading === "string"
          ? token.reading
          : (token.reading?.hiragana || "");

        const showFurigana =
          token.is_japanese &&
          hasKanji(token.surface) &&
          readingStr &&
          readingStr !== token.surface;

        if (variant === "sentence" && !token.is_japanese) {
          return <span key={i} className="hk-token-punctuation">{token.surface}</span>;
        }
        const sentenceSurface = variant === "sentence" ? distributeFurigana(token.surface, readingStr) : null;

        return (
          <button
            type="button"
            key={i}
            className={`hk-token ${!token.is_japanese ? "hk-token--non-jp" : ""} ${
              selectedIndex === i ? "hk-token--selected" : ""
            }`}
            onClick={() => onSelect(i)}
            aria-pressed={selectedIndex === i}
            title={token.is_japanese ? `${token.dictionary_form} — ${token.pos}` : token.surface}
          >
            {sentenceSurface ? <span className="hk-token__surface">{sentenceSurface.map((part, index) =>
              part.ruby ? <ruby key={index}>{part.text}<rt>{part.ruby}</rt></ruby> : <span key={index}>{part.text}</span>)}</span> : <>
            <span className="hk-token__reading" aria-hidden="true">
              {showFurigana ? readingStr : "\u00A0"}
            </span>
            <span className="hk-token__surface">
              {token.surface}
            </span>
            </>}
          </button>
        );
      })}
    </div>
  );
}
