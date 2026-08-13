import type { TokenAnalysis } from "~lib/types";

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
      {tokens.map((token, i) => (
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
            {token.is_japanese && token.reading.hiragana !== token.surface
              ? token.reading.hiragana
              : "\u00A0"}
          </span>
          <span className="hk-token__surface">
            {token.surface}
          </span>
        </div>
      ))}
    </div>
  );
}
