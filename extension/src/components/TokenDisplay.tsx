import type { TokenAnalysis } from "~types";

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
    <div
      className="hk-tokens"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "6px",
        marginBottom: "12px",
        padding: "10px",
        borderRadius: "8px",
        background: "rgba(255,255,255,0.045)",
        border: "1px solid rgba(148,163,184,0.2)",
      }}
    >
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
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            flex: "0 0 auto",
            minWidth: "fit-content",
            padding: "4px 6px",
            borderRadius: "6px",
            cursor: "pointer",
            background:
              selectedIndex === i ? "rgba(245, 158, 11, 0.18)" : "transparent",
            boxShadow:
              selectedIndex === i
                ? "inset 0 0 0 1px rgba(245, 158, 11, 0.8)"
                : "none",
          }}
        >
          <span
            className="hk-token__reading"
            style={{
              minHeight: "13px",
              color: "#f9a8d4",
              fontSize: "10px",
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {token.is_japanese && token.reading.hiragana !== token.surface
              ? token.reading.hiragana
              : "\u00A0"}
          </span>
          <span
            className="hk-token__surface"
            style={{
              color: token.is_japanese ? "#f8fafc" : "#94a3b8",
              fontSize: token.is_japanese ? "17px" : "14px",
              lineHeight: 1.35,
              whiteSpace: "nowrap",
            }}
          >
            {token.surface}
          </span>
        </div>
      ))}
    </div>
  );
}
