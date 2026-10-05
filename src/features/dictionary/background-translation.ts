import { deduplicateCueText } from "~/shared/japanese/text-normalization";

export async function translateWithGoogle(
  text: string,
  targetLang: string,
): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";

  const tl = targetLang.startsWith("vi")
    ? "vi"
    : targetLang.startsWith("en")
      ? "en"
      : targetLang.startsWith("zh")
        ? "zh-CN"
        : targetLang.startsWith("ko")
          ? "ko"
          : targetLang.startsWith("ja")
            ? "ja"
            : targetLang;

  // 1. Primary: gtx single endpoint with browser headers
  try {
    const url1 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`;
    const res1 = await fetch(url1, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://translate.google.com/",
      },
    });
    if (res1.ok) {
      const data = await res1.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const uniquePieces: string[] = [];
        const seen = new Set<string>();
        for (const item of data[0]) {
          if (
            Array.isArray(item) &&
            typeof item[0] === "string" &&
            item[0].trim()
          ) {
            const piece = item[0].trim();
            const key = piece
              .toLowerCase()
              .replace(/^[\s.,!?。！？:;\-\/]+|[\s.,!?。！？:;\-\/]+$/g, "");
            if (key && !seen.has(key)) {
              seen.add(key);
              uniquePieces.push(piece);
            }
          }
        }
        const trans = deduplicateCueText(uniquePieces.join(" "));
        if (trans) return trans;
      }
    }
  } catch {}

  // 2. Secondary fallback: dict-chrome-ex client
  try {
    const url2 = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(clean)}`;
    const res2 = await fetch(url2, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (res2.ok) {
      const data = await res2.json();
      if (Array.isArray(data) && data[0]) {
        return deduplicateCueText(String(data[0]));
      } else if (typeof data === "string") {
        return deduplicateCueText(data);
      }
    }
  } catch {}

  return "";
}
