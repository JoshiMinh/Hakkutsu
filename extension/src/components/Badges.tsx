import { formatPosLabel } from "~lib/utils/constants";
import { useTranslation } from "~lib/languages/locales";

export function JlptBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const match = level.match(/n?[1-5]/i);
  const normalized = match ? (match[0].toUpperCase().startsWith("N") ? match[0].toUpperCase() : `N${match[0]}`) : level.toUpperCase();
  const cls = `hk-badge hk-badge--${normalized.toLowerCase()}`;
  return <span className={cls}>{normalized}</span>;
}

export function PosBadge({ pos }: { pos: string | null | undefined }) {
  const { lang } = useTranslation();
  if (!pos) return null;
  const label = formatPosLabel(pos, lang);
  if (!label) return null;
  return <span className="hk-badge hk-badge--pos">{label}</span>;
}

export function FrequencyBadge({ rank }: { rank: number | null }) {
  const { isVietnamese } = useTranslation();
  if (!rank) return null;
  const tooltip = isVietnamese
    ? `Xếp hạng tần suất sử dụng: #${rank.toLocaleString()}`
    : `Frequency Rank: #${rank.toLocaleString()}`;

  return (
    <span className="hk-badge hk-badge--freq" title={tooltip}>
      #{rank.toLocaleString()}
    </span>
  );
}
