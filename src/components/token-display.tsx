import type { TokenAnalysis } from "~lib/utils/types";
import { hasKanji } from "~lib/utils/japanese";

export function TokenDisplay({
  tokens,
  selectedIndex,
  onSelect,
}: {
  tokens: TokenAnalysis[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="hk-tokens">
      {tokens.map((token, i) => {
        const readingStr = typeof token.reading === "string"
          ? token.reading
          : (token.reading?.hiragana || "");

        const showFurigana =
          token.is_japanese &&
          hasKanji(token.surface) &&
          readingStr &&
          readingStr !== token.surface;

        return (
          <div
            key={i}
            className={`hk-token ${!token.is_japanese ? "hk-token--non-jp" : ""} ${
              selectedIndex === i ? "hk-token--selected" : ""
            }`}
            onClick={() => onSelect(i)}
            role="button"
            tabIndex={0}
            title={token.is_japanese ? `${token.dictionary_form} — ${token.pos}` : token.surface}
          >
            <span className="hk-token__reading">
              {showFurigana ? readingStr : "\u00A0"}
            </span>
            <span className="hk-token__surface">
              {token.surface}
            </span>
          </div>
        );
      })}
    </div>
  );
}
