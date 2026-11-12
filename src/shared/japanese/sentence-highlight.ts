import { refineJapaneseTokens } from "~/features/dictionary/japanese-token-refinement";
import { getDB, searchDictionary, type DictEntry } from "~/features/dictionary/local-lookup";
import type { Token } from "~/features/dictionary/local-tokenizer";
import type { SrsCard } from "~/features/srs/local-srs";

interface Glyph { from: number; to: number; node: number; bold: boolean }
interface VisibleText { text: string; glyphs: Glyph[] }
export interface TextRange { start: number; end: number }

function decode(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  if (!value.startsWith("&")) return value;
  const match = value.match(/^&#(x[\da-f]+|\d+);$/i);
  if (match) {
    const code = match[1][0].toLowerCase() === "x" ? parseInt(match[1].slice(1), 16) : Number(match[1]);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : value;
  }
  return named[value.slice(1, -1)] || value;
}

/** DOM-free so the same transformation works in extension pages and service workers. */
function visibleText(html: string): VisibleText {
  let text = "", bold = 0, hidden = 0, node = 0;
  const glyphs: Glyph[] = [];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>|[^<]+|</g)) {
    const value = token[0], offset = token.index!;
    if (value.startsWith("<")) {
      const tag = value.match(/^<(\/?)([\w-]+)/);
      if (!tag) continue;
      const closing = !!tag[1], name = tag[2].toLowerCase();
      if (["rt", "rp", "script", "style"].includes(name)) hidden = Math.max(0, hidden + (closing ? -1 : 1));
      if (name === "b" || name === "strong") bold = Math.max(0, bold + (closing ? -1 : 1));
      if (name === "br" && !hidden) { text += "\n"; glyphs.push({ from: offset, to: offset + value.length, node: -1, bold: true }); }
      continue;
    }
    if (hidden) continue;
    node++;
    for (const part of value.matchAll(/&(?:#x[\da-f]+|#\d+|[a-z]+);|[^&]|&/gi)) {
      const decoded = decode(part[0]);
      text += decoded;
      for (let i = 0; i < decoded.length; i++) glyphs.push({ from: offset + part.index!, to: offset + part.index! + part[0].length, node, bold: bold > 0 });
    }
  }
  return { text, glyphs };
}

export function sentenceText(html: string): string { return visibleText(html).text; }

function segments(text: string): Array<{ segment: string; index: number }> {
  if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter("ja", { granularity: "word" }).segment(text)];
  return [...text.matchAll(/[\p{L}\p{N}々ー]+|[^\p{L}\p{N}々ー]+/gu)].map(match => ({ segment: match[0], index: match.index! }));
}

export function exactWordRanges(text: string, word: string): TextRange[] {
  if (!word) return [];
  const boundaries = new Set([0, text.length]);
  for (const part of segments(text)) { boundaries.add(part.index); boundaries.add(part.index + part.segment.length); }
  const ranges: TextRange[] = [];
  for (let start = text.indexOf(word); start >= 0; start = text.indexOf(word, start + word.length)) {
    if (boundaries.has(start) && boundaries.has(start + word.length)) ranges.push({ start, end: start + word.length });
  }
  return ranges;
}

export function boldSentenceRanges(html: string, ranges: TextRange[]): string {
  const { glyphs } = visibleText(html);
  const merged: TextRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const groups: Array<{ from: number; to: number; node: number }> = [];
  for (const { start, end } of merged) {
    for (const glyph of glyphs.slice(start, end)) {
      if (glyph.bold || glyph.node < 0) continue;
      const last = groups[groups.length - 1];
      if (last && last.node === glyph.node && glyph.from <= last.to) last.to = Math.max(last.to, glyph.to);
      else groups.push({ from: glyph.from, to: glyph.to, node: glyph.node });
    }
  }
  let result = html;
  for (const group of groups.reverse()) result = result.slice(0, group.from) + "<b>" + result.slice(group.from, group.to) + "</b>" + result.slice(group.to);
  return result;
}

async function confirmedRanges(text: string, word: string, lookup: (word: string) => Promise<DictEntry[]>): Promise<TextRange[]> {
  const entries = (await lookup(word)).filter(entry => entry.kanjiElements.includes(word) || entry.readingElements.includes(word));
  if (entries.length !== 1) return [];
  const forms = new Set([word, ...entries[0].kanjiElements]);
  const raw: Token[] = segments(text).map(part => ({ surface_form: part.segment, base_form: part.segment, pos: "Word" }));
  const refined = await refineJapaneseTokens(raw, lookup, true);
  let offset = 0;
  const ranges: TextRange[] = [];
  for (const token of refined) {
    const start = text.indexOf(token.surface_form, offset);
    if (start < 0) continue;
    offset = start + token.surface_form.length;
    if (token.dictionary_reading && forms.has(token.base_form)) ranges.push({ start, end: offset });
  }
  return ranges;
}

export async function highlightSentenceFields(card: Pick<SrsCard, "word" | "sentence" | "sentence_furigana">,
  lookup?: (word: string) => Promise<DictEntry[]>): Promise<Pick<SrsCard, "sentence" | "sentence_furigana">> {
  const sentence = card.sentence || "", furigana = card.sentence_furigana || "";
  const text = sentenceText(sentence);
  // Formatting must never silently repair or change a mismatched sentence.
  if (!text || (furigana && sentenceText(furigana) !== text)) return { sentence: card.sentence, sentence_furigana: card.sentence_furigana };
  const ranges = exactWordRanges(text, card.word);
  if (/[うくぐすつぬぶむるい]$/u.test(card.word)) {
    try {
      if (!lookup) {
        const db = await getDB();
        if (db.objectStoreNames.contains("jmdict") && await db.count("jmdict") > 0) lookup = searchDictionary;
      }
      if (lookup) ranges.push(...await confirmedRanges(text, card.word, lookup));
    } catch { /* Exact token matches remain available without a dictionary. */ }
  }
  const unique = [...new Map(ranges.map(range => [`${range.start}:${range.end}`, range])).values()];
  return { sentence: boldSentenceRanges(sentence, unique), sentence_furigana: furigana ? boldSentenceRanges(furigana, unique) : card.sentence_furigana };
}
