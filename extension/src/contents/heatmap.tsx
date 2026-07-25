import type { PlasmoCSConfig } from "plasmo";
import { useState } from "react";
import cssText from "data-text:~style.css";
import { containsJapanese } from "~lib/japanese";
import { getVocabulary } from "~services/storage";
import type { TokenAnalysis, WebTranslateResponse } from "~types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
};

export const getStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText;
  return style;
};

export const getRootContainer = () =>
  new Promise<HTMLElement>((resolve) => {
    const mount = () => {
      if (!document.body) {
        window.setTimeout(mount, 50);
        return;
      }
      const existing = document.getElementById("hakkutsu-heatmap");
      if (existing) {
        resolve(existing);
        return;
      }
      const rootContainer = document.createElement("div");
      rootContainer.id = "hakkutsu-heatmap";
      document.body.appendChild(rootContainer);
      resolve(rootContainer);
    };
    mount();
  });

const WRAPPER_ATTRIBUTE = "data-hakkutsu-heatmap-wrapper";
const MAX_TEXTS = 80;
const MAX_TOTAL_CHARACTERS = 20_000;
const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "textarea",
  "input",
  "select",
  "option",
  "code",
  "pre",
  "svg",
  "canvas",
  "[contenteditable='true']",
  "#hakkutsu-heatmap",
  `[${WRAPPER_ATTRIBUTE}]`,
].join(",");

function collectJapaneseTextNodes(): Text[] {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        const text = node.textContent?.trim() || "";
        if (
          !parent ||
          !text ||
          text.length > 2_000 ||
          !containsJapanese(text) ||
          parent.closest(SKIP_SELECTOR)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        const style = window.getComputedStyle(parent);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          parent.getClientRects().length === 0
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const nodes: Text[] = [];
  let totalCharacters = 0;
  let current: Node | null;
  while ((current = walker.nextNode()) && nodes.length < MAX_TEXTS) {
    const text = current.textContent?.trim() || "";
    if (totalCharacters + text.length > MAX_TOTAL_CHARACTERS) break;
    nodes.push(current as Text);
    totalCharacters += text.length;
  }
  return nodes;
}

function restoreOriginalText(): void {
  document
    .querySelectorAll<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    .forEach((wrapper) => {
      wrapper.replaceWith(document.createTextNode(wrapper.dataset.originalText || ""));
    });
}

function tokenKey(token: TokenAnalysis): string {
  return (token.dictionary_form || token.surface).trim();
}

function originalTextFragment(
  source: string,
  tokens: TokenAnalysis[],
  knownWords: Set<string>
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  const trimmed = source.trim();
  const reconstructed = tokens.map((token) => token.surface).join("");

  if (leading) fragment.appendChild(document.createTextNode(leading));
  if (reconstructed !== trimmed || tokens.length === 0) {
    fragment.appendChild(document.createTextNode(trimmed));
  } else {
    for (const token of tokens) {
      const span = document.createElement("span");
      span.textContent = token.surface;
      if (token.is_japanese) {
        const known =
          token.srs_state === "graduated" ||
          token.srs_state === "review" ||
          knownWords.has(tokenKey(token)) ||
          knownWords.has(token.surface.trim());
        span.style.borderBottom = `2px solid ${known ? "#10b981" : "#ef4444"}`;
        span.style.backgroundColor = known
          ? "rgba(16, 185, 129, 0.12)"
          : "rgba(239, 68, 68, 0.10)";
        span.title = known ? "Đã lưu trong từ vựng" : "Từ chưa lưu";
      }
      fragment.appendChild(span);
    }
  }
  if (trailing) fragment.appendChild(document.createTextNode(trailing));
  return fragment;
}

function renderTranslation(
  node: Text,
  translation: string,
  tokens: TokenAnalysis[],
  knownWords: Set<string>
): boolean {
  const parent = node.parentNode;
  const originalText = node.textContent || "";
  if (!parent || !translation.trim()) return false;

  const wrapper = document.createElement("span");
  wrapper.setAttribute(WRAPPER_ATTRIBUTE, "true");
  wrapper.dataset.originalText = originalText;
  wrapper.style.display = "inline";

  const original = document.createElement("span");
  original.appendChild(originalTextFragment(originalText, tokens, knownWords));
  wrapper.appendChild(original);

  const translated = document.createElement("span");
  translated.textContent = translation;
  translated.lang = "vi";
  translated.style.display = "block";
  translated.style.margin = "0.18em 0 0.35em";
  translated.style.paddingLeft = "0.55em";
  translated.style.borderLeft = "3px solid #8b5cf6";
  translated.style.color = "#7c3aed";
  translated.style.fontSize = "0.92em";
  translated.style.lineHeight = "1.35";
  translated.style.fontStyle = "italic";
  translated.title = "Bản dịch tiếng Việt của Hakkutsu";
  wrapper.appendChild(translated);

  parent.replaceChild(wrapper, node);
  return true;
}

const Heatmap = () => {
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const disableHeatmap = () => {
    restoreOriginalText();
    setIsActive(false);
    setError(null);
    setStatus(null);
  };

  const applyHeatmap = async () => {
    if (isActive) {
      disableHeatmap();
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Đang tìm nội dung tiếng Nhật...");

    try {
      const textNodes = collectJapaneseTextNodes();
      if (textNodes.length === 0) {
        throw new Error("Trang hiện tại không có đoạn tiếng Nhật hiển thị để dịch.");
      }

      const uniqueTexts = Array.from(
        new Set(textNodes.map((node) => node.textContent?.trim() || "").filter(Boolean))
      );
      setStatus(`Đang dịch ${uniqueTexts.length} đoạn...`);

      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_PAGE",
        payload: {
          texts: uniqueTexts,
          pageUrl: window.location.href,
          pageTitle: document.title,
        },
      });
      if (response?.type === "ERROR") {
        throw new Error(response.payload?.error || "Backend dịch trang trả về lỗi.");
      }
      if (response?.type !== "TRANSLATE_PAGE_RESULT") {
        throw new Error("Extension không nhận được kết quả dịch trang từ background.");
      }

      const result = response.payload as WebTranslateResponse;
      const translatedBySource = new Map(
        result.items.map((item) => [item.source, item])
      );
      const vocabulary = await getVocabulary();
      const knownWords = new Set(
        vocabulary.flatMap((entry) => [entry.word.trim(), entry.reading.trim()])
      );

      let rendered = 0;
      for (const node of textNodes) {
        const source = node.textContent?.trim() || "";
        const item = translatedBySource.get(source);
        if (
          item &&
          renderTranslation(node, item.translation, item.tokens, knownWords)
        ) {
          rendered += 1;
        }
      }
      if (rendered === 0) {
        throw new Error("Backend trả kết quả nhưng không có đoạn dịch hợp lệ để hiển thị.");
      }

      setIsActive(true);
      setStatus(`Đã dịch ${rendered} đoạn · đỏ: từ mới · xanh: từ đã lưu`);
    } catch (caught) {
      restoreOriginalText();
      setIsActive(false);
      setStatus(null);
      setError(caught instanceof Error ? caught.message : "Heatmap thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 2147483647,
        maxWidth: "420px",
        background: "var(--hk-bg, #1a1a2e)",
        color: "var(--hk-text, #f3f4f6)",
        borderRadius: "16px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        border: "1px solid var(--hk-border, #2a2a40)",
        padding: "10px 14px",
        fontFamily: "var(--hk-font-jp, sans-serif)",
        pointerEvents: "auto",
        display: "grid",
        gap: "7px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ fontSize: 14, fontWeight: "bold", flex: 1 }}>
          Hakkutsu Translate + Heatmap
        </div>
        <button
          className={`hk-btn ${isActive ? "hk-btn--secondary" : "hk-btn--primary"} hk-btn--sm`}
          onClick={applyHeatmap}
          disabled={loading}
        >
          {loading ? "⏳ Đang xử lý..." : isActive ? "🛑 Tắt" : "🔥 Dịch trang"}
        </button>
      </div>
      {status && (
        <div style={{ color: "#a7f3d0", fontSize: 11, lineHeight: 1.35 }}>
          {status}
        </div>
      )}
      {error && (
        <div style={{ color: "#fca5a5", fontSize: 11, lineHeight: 1.35 }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default Heatmap;
