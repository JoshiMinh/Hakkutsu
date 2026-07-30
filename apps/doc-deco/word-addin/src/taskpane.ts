import "./styles.css";

type Role =
  | "title" | "subtitle" | "heading_1" | "heading_2" | "heading_3"
  | "body" | "list_item" | "quote" | "caption" | "note";

type ParagraphPayload = {
  paragraph_id: string;
  text: string;
  index: number;
  previous_text: string;
  next_text: string;
  current_style: string;
  layout_features: Record<string, number>;
  is_first_non_empty: boolean;
  force_model?: boolean;
};

type Classification = {
  paragraph_id: string;
  text_hash: string;
  role: Role;
  confidence: number;
  source: string;
  reason: string;
  semantic_label?: string | null;
  unchanged: boolean;
};

type StylePreset = {
  wordStyle: string;
  alignment: string;
  bold: boolean;
  italic?: boolean;
  fontSize: number;
  firstLineIndent: number;
  leftIndent: number;
  rightIndent?: number;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
let officeReady = false;
let busy = false;
let autoTimer: number | undefined;
let styles: Record<Role, StylePreset> | null = null;
let documentId = "docdeco-demo";
const textHashes = new Map<string, string>();

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <div class="brand"><div class="mark">D</div><div><h1>DocDeco</h1><p class="tagline">Nội dung của bạn, bố cục nhất quán.</p></div></div>
      <div class="status"><span id="status-dot" class="dot"></span><span id="status-text">Đang kết nối dịch vụ local…</span></div>
    </header>
    <main>
      <section id="word-tools" class="panel hidden">
        <div class="toggle">
          <div><h2>Tự định dạng khi nhập</h2><div class="muted">Chỉ xử lý đoạn vừa thay đổi, không gửi lại cả file.</div></div>
          <label class="switch"><input id="auto-mode" type="checkbox"><span class="slider"></span></label>
        </div>
      </section>
      <section id="word-actions" class="panel hidden">
        <h2>Định dạng tài liệu</h2>
        <div class="stack">
          <button id="format-selection" class="primary">Định dạng đoạn đang chọn</button>
          <button id="format-changed" class="secondary">Định dạng phần thay đổi</button>
          <button id="format-all" class="ghost">Chuẩn hóa toàn bộ tài liệu</button>
        </div>
      </section>
      <section id="override-panel" class="panel hidden">
        <h2>Sửa vai trò đoạn đang chọn</h2>
        <div class="row">
          <select id="role-select">
            <option value="title">Tiêu đề</option><option value="subtitle">Phụ đề</option>
            <option value="heading_1">Ý lớn cấp 1</option><option value="heading_2">Ý lớn cấp 2</option>
            <option value="heading_3">Ý nhỏ cấp 3</option><option value="body">Đoạn văn</option>
            <option value="list_item">Danh sách</option><option value="quote">Trích dẫn</option>
            <option value="caption">Chú thích</option><option value="note">Ghi chú</option>
          </select>
          <button id="apply-role" class="secondary">Áp dụng</button>
        </div>
      </section>
      <section id="demo" class="panel hidden">
        <h2>Demo ngoài Word</h2>
        <p class="muted">Mỗi dòng trống tạo một đoạn mới. Kết quả dùng đúng classifier của Word add-in.</p>
        <textarea id="demo-text">ỨNG DỤNG TRÍ TUỆ NHÂN TẠO

1. Tổng quan đề tài

Đề tài xây dựng một ứng dụng chạy local để tự động chuẩn hóa bố cục tài liệu Word.

1.1 Mục tiêu

- Nhận diện tiêu đề và các cấp ý
- Chỉ định dạng đoạn vừa thay đổi

Hình 1. Kiến trúc tổng quát</textarea>
        <button id="demo-run" class="primary">Phân tích bố cục</button>
        <div id="preview" class="preview"></div>
      </section>
      <section class="panel"><div id="last-result" class="last-result">Chưa có đoạn nào được xử lý.</div></section>
      <div id="toast" class="toast"></div>
    </main>
  </div>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function setStatus(ok: boolean, message: string) {
  $("#status-dot").className = `dot ${ok ? "ok" : "bad"}`;
  $("#status-text").textContent = message;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/docdeco${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, ...init
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : response.json();
}

async function connect() {
  try {
    const health = await api<{ model_enabled: boolean }>("/health");
    styles = await api<Record<Role, StylePreset>>("/styles");
    setStatus(true, health.model_enabled ? "Local API + Ollama đã sẵn sàng" : "Local API sẵn sàng · đang dùng bộ luật nhanh");
  } catch {
    setStatus(false, "Không kết nối được local API ở cổng 8010");
  }
}

function toPayloads(items: { text: string; style?: string; features?: Record<string, number> }[]): ParagraphPayload[] {
  const first = items.findIndex(item => item.text.trim().length > 0);
  return items.map((item, index) => ({
    paragraph_id: `p-${index}`, text: item.text, index,
    previous_text: items[index - 1]?.text || "", next_text: items[index + 1]?.text || "",
    current_style: item.style || "", layout_features: item.features || {},
    is_first_non_empty: index === first
  }));
}

async function classify(paragraphs: ParagraphPayload[]): Promise<Classification[]> {
  return api("/classify/batch", {
    method: "POST", body: JSON.stringify({ document_id: documentId, paragraphs })
  });
}

function showResult(result: Classification) {
  const semantic = result.semantic_label ? ` · ${result.semantic_label}` : "";
  $("#last-result").innerHTML = `<strong>${result.role.replace("_", " ")}</strong>${semantic} · ${Math.round(result.confidence * 100)}% · ${result.source}<br>${result.reason}`;
}

function toast(message: string) {
  $("#toast").textContent = message;
  window.setTimeout(() => { $("#toast").textContent = ""; }, 3000);
}

function simpleHash(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

async function scanWord(changedOnly: boolean): Promise<{ paragraphs: ParagraphPayload[]; indices: number[] }> {
  return Word.run(async context => {
    const collection = context.document.body.paragraphs;
    collection.load(
      "items/text,items/style,items/alignment,items/firstLineIndent,items/leftIndent," +
      "items/spaceBefore,items/spaceAfter,items/isListItem,items/outlineLevel,items/tableNestingLevel"
    );
    await context.sync();
    const all = collection.items.map(p => {
      const alignment = String(p.alignment).toLowerCase();
      const style = p.style || "";
      const outline = Number(p.outlineLevel);
      return {
        text: p.text,
        style,
        features: {
          is_centered: Number(alignment.includes("center")),
          is_justified: Number(alignment.includes("justif")),
          is_right_aligned: Number(alignment.includes("right")),
          first_line_indent: Math.min(Math.abs(p.firstLineIndent || 0) / 72, 2),
          left_indent: Math.min(Math.abs(p.leftIndent || 0) / 144, 2),
          space_before: Math.min(Math.abs(p.spaceBefore || 0) / 72, 2),
          space_after: Math.min(Math.abs(p.spaceAfter || 0) / 72, 2),
          has_numbering: Number(p.isListItem),
          numbering_depth: p.isListItem ? Math.max(outline, 1) : 0,
          outline_level: Number.isFinite(outline) ? outline : 9,
          is_in_table: Number(p.tableNestingLevel > 0),
          style_is_heading: Number(style.toLowerCase().startsWith("heading")),
          style_is_caption: Number(style.toLowerCase().includes("caption")),
          style_is_list: Number(style.toLowerCase().includes("list"))
        }
      };
    });
    const payloads = toPayloads(all);
    const indices: number[] = [];
    const selected = payloads.filter((p, index) => {
      const hash = simpleHash(`${p.text}|${p.current_style}`);
      const changed = textHashes.get(p.paragraph_id) !== hash;
      if (!changedOnly || changed) {
        indices.push(index);
        textHashes.set(p.paragraph_id, hash);
        return true;
      }
      return false;
    });
    return { paragraphs: selected, indices };
  });
}

function applyPreset(paragraph: Word.Paragraph, preset: StylePreset) {
  paragraph.style = preset.wordStyle;
  paragraph.alignment = preset.alignment.toLowerCase() as Word.Alignment;
  paragraph.firstLineIndent = preset.firstLineIndent;
  paragraph.leftIndent = preset.leftIndent;
  paragraph.rightIndent = preset.rightIndent || 0;
  paragraph.spaceBefore = preset.spaceBefore;
  paragraph.spaceAfter = preset.spaceAfter;
  paragraph.lineSpacing = preset.lineSpacing * preset.fontSize;
  const range = paragraph.getRange();
  range.font.bold = preset.bold;
  range.font.italic = preset.italic || false;
  range.font.size = preset.fontSize;
}

async function applyResults(results: Classification[], indices: number[]) {
  if (!styles) throw new Error("Chưa tải style presets.");
  await Word.run(async context => {
    const collection = context.document.body.paragraphs;
    collection.load("items");
    await context.sync();
    results.forEach((result, offset) => {
      const paragraph = collection.items[indices[offset]];
      if (paragraph) applyPreset(paragraph, styles![result.role]);
    });
    await context.sync();
  });
  if (results.length) showResult(results[results.length - 1]);
}

async function formatDocument(changedOnly: boolean) {
  if (busy) return;
  busy = true;
  try {
    const { paragraphs, indices } = await scanWord(changedOnly);
    if (!paragraphs.length) return toast("Không có đoạn mới thay đổi.");
    const results = await classify(paragraphs);
    await applyResults(results, indices);
    toast(`Đã định dạng ${results.length} đoạn.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Không thể định dạng.");
  } finally { busy = false; }
}

async function formatSelection() {
  if (!styles || busy) return;
  busy = true;
  try {
    await Word.run(async context => {
      const paragraphs = context.document.getSelection().paragraphs;
      paragraphs.load("items/text,items/style");
      await context.sync();
      const payloads = toPayloads(paragraphs.items.map(p => ({ text: p.text, style: p.style || "" })));
      payloads.forEach((p, i) => p.paragraph_id = `selection-${i}`);
      const results = await classify(payloads);
      results.forEach((result, i) => applyPreset(paragraphs.items[i], styles![result.role]));
      await context.sync();
      if (results.length) showResult(results[results.length - 1]);
    });
  } finally { busy = false; }
}

async function overrideSelection() {
  if (!styles) return;
  const role = $("#role-select") as HTMLSelectElement;
  await Word.run(async context => {
    const paragraphs = context.document.getSelection().paragraphs;
    paragraphs.load("items/text,items/style");
    await context.sync();
    const payloads = toPayloads(paragraphs.items.map(p => ({ text: p.text, style: p.style || "" })));
    payloads.forEach((p, i) => p.paragraph_id = `feedback-${i}`);
    const predictions = await classify(payloads);
    await Promise.all(predictions.map((prediction, index) => api("/feedback", {
      method: "POST",
      body: JSON.stringify({
        document_id: documentId,
        paragraph_id: payloads[index].paragraph_id,
        text: payloads[index].text,
        predicted_role: prediction.role,
        corrected_role: role.value,
        context: {
          previous_text: payloads[index].previous_text,
          next_text: payloads[index].next_text,
          current_style: payloads[index].current_style
        }
      })
    })));
    paragraphs.items.forEach(p => applyPreset(p, styles![role.value as Role]));
    await context.sync();
  });
  toast("Đã áp dụng vai trò thủ công.");
}

async function runDemo() {
  const texts = ($("#demo-text") as HTMLTextAreaElement).value.split(/\n\s*\n/);
  const payloads = toPayloads(texts.map(text => ({ text })));
  const results = await classify(payloads);
  $("#preview").innerHTML = results.map((result, i) =>
    `<div class="preview-item ${result.role}"><strong>${result.role.replace("_", " ")}</strong><span>${escapeHtml(texts[i])}</span></div>`
  ).join("");
  if (results.length) showResult(results[results.length - 1]);
}

function escapeHtml(text: string) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showMode(word: boolean) {
  officeReady = word;
  ["#word-tools", "#word-actions", "#override-panel"].forEach(id => $(id).classList.toggle("hidden", !word));
  $("#demo").classList.toggle("hidden", word);
}

$("#format-selection").addEventListener("click", formatSelection);
$("#format-changed").addEventListener("click", () => formatDocument(true));
$("#format-all").addEventListener("click", () => { textHashes.clear(); void formatDocument(false); });
$("#apply-role").addEventListener("click", overrideSelection);
$("#demo-run").addEventListener("click", runDemo);
$("#auto-mode").addEventListener("change", event => {
  const enabled = (event.target as HTMLInputElement).checked;
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = enabled ? window.setInterval(() => void formatDocument(true), 1600) : undefined;
  localStorage.setItem("docdeco-auto", String(enabled));
});

void connect();
let officeBooted = false;
const officeTimeout = window.setTimeout(() => {
  if (!officeBooted) showMode(false);
}, 1800);

if (typeof Office !== "undefined") {
  Office.onReady(info => {
    officeBooted = true;
    window.clearTimeout(officeTimeout);
    showMode(info.host === Office.HostType.Word);
    documentId = `word:${Office.context.document.url || "unsaved-document"}`;
    const auto = localStorage.getItem("docdeco-auto") === "true";
    ($("#auto-mode") as HTMLInputElement).checked = auto;
    if (auto) autoTimer = window.setInterval(() => void formatDocument(true), 1600);
  });
}
