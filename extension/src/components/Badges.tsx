import { POS_LABELS } from "~lib/constants";

export function JlptBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const cls = `hk-badge hk-badge--${level.toLowerCase()}`;
  return <span className={cls}>{level}</span>;
}

export function PosBadge({ pos }: { pos: string }) {
  const label = POS_LABELS[pos] || pos;
  return <span className="hk-badge hk-badge--pos">{label}</span>;
}
