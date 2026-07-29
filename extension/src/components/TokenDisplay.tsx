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
            padding: "4px 8px",
            borderRadius: "6px",
            cursor: "pointer",
            background:
              selectedIndex === i ? "rgba(168, 85, 247, 0.12)" : "transparent",
            boxShadow:
              selectedIndex === i
                ? "inset 0 0 0 1px rgba(168, 85, 247, 0.5), 0 0 10px rgba(168, 85, 247, 0.15)"
                : "inset 0 0 0 1px transparent",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span
            className="hk-token__reading"
            style={{
              minHeight: "14px",
              color: selectedIndex === i ? "var(--hk-accent-primary)" : "var(--hk-text-muted)",
              fontSize: "11px",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              fontWeight: selectedIndex === i ? 600 : 500,
              transition: "color 0.2s ease",
            }}
          >
            {token.is_japanese && token.reading.hiragana !== token.surface
              ? token.reading.hiragana
              : "\u00A0"}
          </span>
          <span
            className="hk-token__surface"
            style={{
              color: token.is_japanese ? (selectedIndex === i ? "var(--hk-text-primary)" : "var(--hk-text-secondary)") : "var(--hk-text-muted)",
              fontSize: token.is_japanese ? "17px" : "14px",
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              fontWeight: selectedIndex === i ? 600 : 400,
              transition: "all 0.2s ease",
            }}
          >
            {token.surface}
          </span>
        </div>
      ))}
    </div>
  );
}
