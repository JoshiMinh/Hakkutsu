import { formatPosLabel } from "./pos-labels";
import { useTranslation } from "~/shared/locales";

export function PosBadge({ pos }: { pos: string | null | undefined }) {
  const { lang } = useTranslation();
  if (!pos) return null;
  const label = formatPosLabel(pos, lang);
  if (!label) return null;
  return <span className="hk-badge hk-badge--pos">{label}</span>;
}
