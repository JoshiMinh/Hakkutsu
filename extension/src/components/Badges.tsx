import { POS_LABELS } from "~lib/utils/constants";

export function JlptBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const normalized = level.toUpperCase();
  const cls = `hk-badge hk-badge--${level.toLowerCase()}`;
  return <span className={cls}>{normalized}</span>;
}

export function PosBadge({ pos }: { pos: string }) {
  if (!pos) return null;
  const label = POS_LABELS[pos] || pos;
  return <span className="hk-badge hk-badge--pos">{label}</span>;
}

export function FrequencyBadge({ rank }: { rank: number | null }) {
  if (!rank) return null;
  return (
    <span className="hk-badge hk-badge--freq" title={`Xếp hạng tần suất sử dụng: #${rank}`}>
      #{rank.toLocaleString()}
    </span>
  );
}
