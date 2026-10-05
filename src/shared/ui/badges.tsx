import { useTranslation } from "~/shared/locales";
import { Wifi } from "lucide-react";

export function JlptBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const match = level.match(/n?[1-5]/i);
  const normalized = match ? (match[0].toUpperCase().startsWith("N") ? match[0].toUpperCase() : `N${match[0]}`) : level.toUpperCase();
  const cls = `hk-badge hk-badge--${normalized.toLowerCase()}`;
  return <span className={cls}>{normalized}</span>;
}

export function FrequencyBadge({ rank }: { rank: number | null }) {
  const { isVietnamese } = useTranslation();
  if (!rank) return null;
  const level = rank <= 1_000
    ? { label: isVietnamese ? "Rất phổ biến" : "Very common", color: "#4ade80" }
    : rank <= 5_000
      ? { label: isVietnamese ? "Phổ biến" : "Common", color: "#22d3ee" }
      : rank <= 15_000
        ? { label: isVietnamese ? "Ít phổ biến" : "Less common", color: "#fbbf24" }
        : { label: isVietnamese ? "Hiếm" : "Rare", color: "#a1a1aa" };
  const tooltip = isVietnamese
    ? `${level.label} trong ngôn ngữ thực tế · Hạng #${rank.toLocaleString()} (số thấp hơn = phổ biến hơn)`
    : `${level.label} in real-world language · Rank #${rank.toLocaleString()} (lower is more common)`;

  return (
    <span
      className="hk-frequency"
      style={{ color: level.color }}
      title={tooltip}
      aria-label={tooltip}
    >
      <Wifi size={14} aria-hidden="true" />
      #{rank.toLocaleString()}
    </span>
  );
}

export default JlptBadge;



/** JLPT level colors for UI badges */
export const JLPT_COLORS: Record<string, { bg: string; text: string }> = {
  N5: { bg: "#22c55e", text: "#ffffff" },
  N4: { bg: "#3b82f6", text: "#ffffff" },
  N3: { bg: "#f59e0b", text: "#1a1a2e" },
  N2: { bg: "#ef4444", text: "#ffffff" },
  N1: { bg: "#a855f7", text: "#ffffff" },
};
