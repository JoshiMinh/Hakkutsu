/**
 * Local Japanese Tokenizer for Hakkutsu.
 * Uses Chrome's native Intl.Segmenter API for 100% offline, zero-latency,
 * robust word segmentation that works reliably in background service workers
 * and content scripts without heavy external dependencies.
 */

export interface Token {
  surface_form: string;
  pos: string;
  reading?: string;
  base_form: string;
}

export async function initNLP(): Promise<void> {
  // Built-in Intl.Segmenter requires no asynchronous network initialization
  return Promise.resolve();
}

/**
 * Tokenize Japanese text into words and punctuation tokens.
 */
export async function tokenize(text: string): Promise<Token[]> {
  if (!text || !text.trim()) return [];

  const cleanText = text.trim();

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new (Intl as any).Segmenter("ja-JP", { granularity: "word" });
    const segments = Array.from(segmenter.segment(cleanText)) as Array<{
      segment: string;
      index: number;
      input: string;
      isWordLike: boolean;
    }>;

    const rawTokens = segments.map((s) => ({
      surface_form: s.segment,
      pos: s.isWordLike ? "Word" : "Punctuation",
      reading: undefined,
      base_form: s.segment,
    }));

    // Merge kanji stems with adjacent hiragana okurigana (e.g. 好 + き -> 好き, 美 + しい -> 美しい)
    // or polite prefixes (お + 好き -> お好き, お + 知らせ -> お知らせ)
    const mergedTokens: Token[] = [];
    let i = 0;
    while (i < rawTokens.length) {
      const cur = rawTokens[i];
      const next = rawTokens[i + 1];

      if (next && cur.pos === "Word" && next.pos === "Word") {
        const curSurface = cur.surface_form;
        const nextSurface = next.surface_form;

        const isKanjiStem = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(curSurface);
        const isHiraganaOkurigana = /^[\u3040-\u309F]+$/.test(nextSurface);
        const isHonorific = curSurface === "お" || curSurface === "ご";

        if ((isKanjiStem && isHiraganaOkurigana) || (isHonorific && /^[\u3040-\u30FF\u4E00-\u9FFF]/.test(nextSurface))) {
          const combined = curSurface + nextSurface;
          mergedTokens.push({
            surface_form: combined,
            pos: "Word",
            reading: undefined,
            base_form: combined,
          });
          i += 2;
          continue;
        }
      }

      mergedTokens.push(cur);
      i++;
    }

    return mergedTokens;
  }

  // Fallback regex segmentation by whitespace and Japanese punctuation
  const words = cleanText.split(/([\s\u3000、。！？!?…]+)/).filter(Boolean);
  return words.map((w) => ({
    surface_form: w,
    pos: "Word",
    reading: undefined,
    base_form: w,
  }));
}

/**
 * Strips or generates basic ruby markup if needed.
 */
export async function getFurigana(text: string): Promise<string> {
  return text;
}
