import { createRoot } from "react-dom/client";
import type { AnalyzeResponse, TokenAnalysis } from "../src/features/dictionary/types";
import { customCss } from "../src/features/dictionary/host-styles";
import "../src/styles/global.css";

// Exercise the production lookup UI and native DOM selections without extension
// storage, network services, or writes to the user's vocabulary collection.
const fixture = document.querySelector<HTMLElement>("#fixture")!;
const player = document.createElement("div");
player.id = "movie_player";
document.body.append(player);
const host = document.createElement("hakkutsu-inline-dictionary-host");
document.querySelector("#lookup")!.append(host);
const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style"); style.textContent = customCss;
const lookup = document.createElement("div");
shadow.append(style, lookup);
const results = document.querySelector<HTMLElement>("#results")!;
const listener = { addListener() {}, removeListener() {} };
type Message = { type: string; payload?: Record<string, any> };
const requests: Message[] = [];
let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
let responseMode: "normal" | "mismatch" | "invalid" | "error" = "normal";

function response(text: string): AnalyzeResponse & { translation: string } {
  const tokens: TokenAnalysis[] = Array.from(new (Intl as any).Segmenter("ja", { granularity: "word" }).segment(text), (part: any) => ({
    surface: part.segment, dictionary_form: part.segment, pos: "Word", pos_detail: [],
    reading: { hiragana: "", romaji: "" }, is_japanese: Boolean(part.isWordLike),
    jlpt_level: null, frequency_rank: null,
    definitions: part.isWordLike ? [{ glosses: [`${part.segment} meaning`], pos: [], field: null, misc: [] }] : [],
  }));
  return { text, tokens, translation: text.includes("辞書") ? "" : `Translation: ${text}`,
    sentence_reading: text, token_count: tokens.length, difficulty_score: null, difficulty_label: null };
}

const runtime = { getURL: () => "data:image/png;base64,", onMessage: listener,
  async sendMessage(message: Message) {
    if (message.type.startsWith("ANALYZE_")) {
      requests.push(message);
      const wait = gate; gate = undefined;
      if (wait) await wait;
      if (responseMode === "invalid") return {};
      if (responseMode === "error") throw new Error("Internal provider error");
      const payload = response(message.payload!.text);
      if (responseMode === "mismatch") payload.text = "別の文章";
      else if (payload.translation && message.payload!.target_language !== "en") payload.translation = `[${message.payload!.target_language}] ${payload.text}`;
      return { type: message.type === "ANALYZE_PHRASE" ? "ANALYZE_PHRASE_RESULT" : "ANALYZE_RESULT",
        payload };
    }
    if (message.type === "ADD_SRS_CARD") {
      requests.push(message);
      return { type: "SRS_RESULT", payload: {} };
    }
    return { type: "CARD_EXISTS_RESULT", payload: { exists: false, images: [] } };
  },
};
Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime,
  storage: { sync: { async get() { return {}; }, async set() {} }, onChanged: listener } } });
Object.defineProperty(globalThis, "browser", { configurable: true, value: { runtime } });
// Definition enrichment is unrelated to selection handling; keep it offline.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => new URL(String(input), location.href).origin === location.origin
  ? realFetch(input, init) : Promise.resolve(new Response(JSON.stringify({ data: [], results: [] })));

const { useSettingsStore } = await import("../src/features/settings/settings-store");
await useSettingsStore.persist.rehydrate();
useSettingsStore.setState(state => ({ isHydrated: true,
  settings: { ...state.settings, targetLanguage: "en", textAnalysisEnabled: true, ankiEnabled: false, mangaOcrEnabled: false } }));
const { default: InlineDictionary } = await import("../src/features/dictionary/inline-dictionary");
const { translations } = await import("../src/shared/locales");
const nativePanel = new URLSearchParams(location.search).has("native");
if (nativePanel) lookup.style.width = "min(420px, 100vw)";
const root = createRoot(lookup);
root.render(<InlineDictionary nativePanel={nativePanel} />);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await sleep(10); }
  throw new Error("Timed out waiting for lookup");
}
function mouse(target: Element, type: string, x: number, buttons = 0, detail = 1) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, button: 0, buttons, detail, clientX: x, clientY: 150 }));
}
function select(target: HTMLElement) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus(); target.setSelectionRange(0, target.value.length);
  } else {
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    const range = document.createRange(); range.selectNodeContents(target);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  }
}
function drag(target: HTMLElement) {
  mouse(target, "mousedown", 10, 1);
  select(target);
  mouse(target, "mousemove", 160, 1);
  mouse(target, "mouseup", 160);
}
function textElement(text: string) {
  const node = document.createElement("p"); node.textContent = text; fixture.replaceChildren(node); return node;
}
const analysisRequests = () => requests.filter(item => item.type.startsWith("ANALYZE_"));
const sentenceText = () => Array.from(lookup.querySelectorAll(".hk-token__surface, .hk-token-punctuation"), node => node.textContent).join("");
const close = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const tests: Array<[string, () => Promise<void>]> = [
  ["Page-text lookup shows a bundled Hán-Việt reading with no provider reading", async () => {
    useSettingsStore.setState(state => ({ settings: { ...state.settings, targetLanguage: "vi", showHanViet: true } }));
    const word = textElement("確実");
    for (let detail = 1; detail <= 2; detail++) {
      mouse(word, "mousedown", 10, 1, detail);
      select(word);
      mouse(word, "mouseup", 10, 0, detail);
    }
    mouse(word, "dblclick", 10, 0, 2);
    await until(() => lookup.textContent?.includes("Hán-Việt: XÁC THỰC") === true);

    useSettingsStore.setState(state => ({ settings: { ...state.settings, showHanViet: false } }));
    try {
      await until(() => !lookup.textContent?.includes("XÁC THỰC"));
    } finally {
      useSettingsStore.setState(state => ({ settings: { ...state.settings, showHanViet: true } }));
    }
  }],
  ["YouTube lookups use the page layer outside fullscreen", async () => {
    const node = textElement("動画のコメントを読みます。");
    drag(node);
    await until(() => sentenceText() === node.textContent);
    assert(host.parentElement === document.body, "comment lookup must mount outside the video player");

    let fullscreenElement: Element | null = player;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    try {
      document.dispatchEvent(new Event("fullscreenchange"));
      assert(host.parentElement === player, "lookup must move into the fullscreen player");

      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      assert(host.parentElement === document.body, "lookup must return to the page after exiting fullscreen");
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
      document.dispatchEvent(new Event("fullscreenchange"));
    }
  }],
  ["Drag analyzes the full wrapped selection across text nodes and lets users select and save any word", async () => {
    const node = textElement("");
    const first = document.createTextNode("「アップグレードして5時間の");
    const nested = document.createElement("strong"); nested.textContent = "利用制限を解除。）」";
    node.append(first, nested);
    const expected = node.textContent!.trim();
    drag(node);
    await until(() => sentenceText() === expected);
    assert(analysisRequests().length === 1, "drag must send exactly one analysis");
    assert(analysisRequests()[0].type === "ANALYZE_PHRASE" && analysisRequests()[0].payload?.text === expected, "request lost selected sentence");
    assert(lookup.querySelector(".hk-translation-text")?.textContent === `Translation: ${expected}`, "sentence translation missing");
    const words = lookup.querySelectorAll<HTMLButtonElement>(".hk-token");
    const last = words[words.length - 1]; last.focus(); last.click();
    await until(() => lookup.querySelector(".hk-definition__word")?.textContent === last.textContent);
    assert(shadow.activeElement === last, `token must remain keyboard focusable; focused ${shadow.activeElement?.tagName}:${shadow.activeElement?.getAttribute("aria-label")}`);
    const footer = lookup.querySelector<HTMLButtonElement>(".hk-popup__footer button")!;
    footer.click(); await until(() => requests.some(item => item.type === "ADD_SRS_CARD"));
    const saved = requests.find(item => item.type === "ADD_SRS_CARD")!.payload!;
    assert(saved.word === last.textContent && saved.sentence === expected, "save lost the selected word or full sentence");
    const rect = lookup.querySelector(".hk-popup")!.getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= innerWidth + 1, "popup exceeds the viewport");
  }],
  ["Textareas and inputs preserve complete selections, punctuation and internal line breaks", async () => {
    for (const tag of ["textarea", "input"] as const) {
      const node = document.createElement(tag); node.value = tag === "textarea" ? "  日本語を\n勉強します。  " : "「学校で学びます！」";
      fixture.replaceChildren(node); drag(node);
      await until(() => sentenceText() === node.value.trim());
      assert(analysisRequests().at(-1)?.payload?.text === node.value.trim(), "form selection changed");
      close(); await sleep(20);
    }
  }],
  ["Inputs and contenteditable text inside page shadow roots retain full selections", async () => {
    const pageHost = document.createElement("div"); fixture.replaceChildren(pageHost);
    const pageShadow = pageHost.attachShadow({ mode: "open" });
    const input = document.createElement("textarea"); input.value = "影の中でも全文を選択します。";
    pageShadow.append(input); drag(input);
    await until(() => sentenceText() === input.value);
    close(); await sleep(20); input.blur();
    const editable = document.createElement("p"); editable.contentEditable = "true"; editable.textContent = "編集できる文章も解析します。";
    pageShadow.append(editable); drag(editable);
    await until(() => sentenceText() === editable.textContent);
  }],
  ["Keyboard selection analyzes the sentence without mouse movement", async () => {
    const node = document.createElement("textarea"); node.value = "キーボードで全文を選択します。";
    fixture.replaceChildren(node); select(node);
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true, bubbles: true, composed: true }));
    await until(() => sentenceText() === node.value);
    assert(analysisRequests()[0]?.type === "ANALYZE_PHRASE", "keyboard selection used word mode");
  }],
  ["Double-click sends one dictionary request and resets sentence mode", async () => {
    const node = textElement("選択");
    for (let detail = 1; detail <= 2; detail++) {
      mouse(node, "mousedown", 10, 1, detail); select(node); mouse(node, "mouseup", 10, 0, detail);
    }
    mouse(node, "dblclick", 10, 0, 2);
    await until(() => lookup.querySelector(".hk-definition__word")?.textContent === "選択");
    assert(analysisRequests().length === 1 && analysisRequests()[0].payload?.analysis_mode === "dictionary", "double-click sent sentence or duplicate requests");
    assert(!lookup.querySelector(".hk-tokens--sentence"), "word lookup retained sentence mode");
  }],
  ["Double-click dragging and triple-clicking analyze the full selected phrase", async () => {
    const node = textElement("中村さんは断ったそう");
    mouse(node, "mousedown", 10, 1, 1); mouse(node, "mouseup", 10, 0, 1);
    mouse(node, "mousedown", 10, 1, 2); select(node);
    mouse(node, "mousemove", 160, 1, 2); mouse(node, "mouseup", 160, 0, 2);
    mouse(node, "dblclick", 160, 0, 2);
    await until(() => sentenceText() === node.textContent);
    assert(analysisRequests().length === 1 && analysisRequests()[0].type === "ANALYZE_PHRASE", "double-click replaced the drag with a word lookup");
    close(); await sleep(20); requests.length = 0;
    // The browser selects the paragraph on the third click, after dblclick.
    for (let detail = 1; detail <= 3; detail++) {
      mouse(node, "mousedown", 10, 1, detail); select(node); mouse(node, "mouseup", 10, 0, detail);
      if (detail === 2) mouse(node, "dblclick", 10, 0, detail);
    }
    await until(() => sentenceText() === node.textContent);
    assert(!analysisRequests().some(item => item.type !== "ANALYZE_PHRASE"), "triple-click used dictionary mode");
  }],
  ["Modifier hover does not interrupt dragging, and remains word lookup afterwards", async () => {
    const node = textElement("学校");
    const original = document.caretRangeFromPoint;
    document.caretRangeFromPoint = () => { const range = document.createRange(); range.setStart(node.firstChild!, 0); return range; };
    const hover = (buttons: number) => node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, altKey: true, buttons, clientX: 30, clientY: 150 }));
    try {
      mouse(node, "mousedown", 10, 1); select(node); hover(1);
      assert(analysisRequests().length === 0, "hover analyzed during drag");
      mouse(node, "mouseup", 30);
      await until(() => sentenceText() === "学校");
      close(); await sleep(20); requests.length = 0;
      hover(0);
      await until(() => !!lookup.querySelector(".hk-definition__word"));
      assert(analysisRequests()[0]?.payload?.analysis_mode === "dictionary" && !lookup.querySelector(".hk-tokens--sentence"), "hover did not return to word mode");
    } finally { document.caretRangeFromPoint = original; }
  }],
  ["Word hover supports the Firefox caret-position API", async () => {
    const node = textElement("辞典");
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    const originalRange = document.caretRangeFromPoint;
    const originalPosition = doc.caretPositionFromPoint;
    try {
      Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: undefined });
      doc.caretPositionFromPoint = () => ({ offsetNode: node.firstChild!, offset: 0 });
      node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, altKey: true, clientX: 30, clientY: 150 }));
      await until(() => lookup.querySelector(".hk-definition__word")?.textContent === "辞典");
      assert(analysisRequests()[0]?.payload?.analysis_mode === "dictionary", "caret-position fallback failed");
    } finally {
      Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, writable: true, value: originalRange });
      doc.caretPositionFromPoint = originalPosition;
    }
  }],
  ["Newer selections win over delayed replies", async () => {
    gate = new Promise(resolve => { release = resolve; });
    drag(textElement("古い文章です。"));
    await until(() => analysisRequests().length === 1);
    drag(textElement("新しい文章です！"));
    await until(() => sentenceText() === "新しい文章です！");
    release!(); await sleep(30);
    assert(sentenceText() === "新しい文章です！", "stale reply replaced the new sentence");
  }],
  ["Starting a drag cancels queued hover lookups", async () => {
    const node = textElement("選択した文章を読みます。");
    window.dispatchEvent(new CustomEvent("hakkutsu:analyze", { detail: {
      text: "保留", mode: "dictionary", transient: true, pauseVideo: false, x: 50, y: 150,
    } }));
    mouse(node, "mousedown", 10, 1); select(node);
    await sleep(220);
    assert(analysisRequests().length === 0, "queued hover opened during selection");
    mouse(node, "mouseup", 160);
    await until(() => sentenceText() === node.textContent);
    assert(analysisRequests().length === 1 && analysisRequests()[0].type === "ANALYZE_PHRASE", "drag lost priority over hover");
  }],
  ["Dictionary fallback without translation still shows the sentence breakdown", async () => {
    drag(textElement("辞書で調べます。"));
    await until(() => sentenceText() === "辞書で調べます。");
    assert(!lookup.querySelector(".hk-translation-text"), "fallback should not invent a translation");
  }],
  ["Switching locale refreshes open sentence results, preserves the selected word, and localizes the header in all eight languages", async () => {
    const node = textElement("言語を変えて文章を調べます。"); drag(node);
    await until(() => sentenceText() === node.textContent);
    const token = lookup.querySelectorAll<HTMLButtonElement>(".hk-token")[1];
    token.click(); await sleep(20);
    const selected = token.textContent;
    for (const language of ["en", "vi", "ja", "zh", "ko", "es", "fr", "id"] as const) {
      useSettingsStore.setState(state => ({ settings: { ...state.settings, targetLanguage: language } }));
      const expected = language === "en" ? `Translation: ${node.textContent}` : `[${language}] ${node.textContent}`;
      await until(() => lookup.querySelector(".hk-translation-text")?.textContent === expected);
      assert(lookup.querySelector("h2")?.textContent?.trim() === translations[language].dict_header_lookup, "header language mismatch");
      assert(lookup.querySelector(".hk-definition__word")?.textContent === selected, "locale switch reset the selected word");
      assert(analysisRequests().at(-1)?.payload?.target_language === language, "analysis request lost the UI language");
    }
  }],
  ["Lookup errors use the current locale after mounting, including invalid results and transport failures", async () => {
    for (const language of ["en", "vi", "ja", "zh", "ko", "es", "fr", "id"] as const) {
      useSettingsStore.setState(state => ({ settings: { ...state.settings, targetLanguage: language } }));
      await sleep(20);
      for (const mode of ["mismatch", "invalid", "error"] as const) {
        responseMode = mode; drag(textElement(`解析の失敗を確認${language}${mode}。`));
        const key = mode === "mismatch" ? "dict_error_result_mismatch" : mode === "invalid" ? "dict_error_invalid_response" : "popup_error_generic";
        await until(() => lookup.querySelector(".hk-error-box")?.textContent === translations[language][key]);
        close(); await sleep(20);
      }
    }
    responseMode = "normal";
  }],
  ["Changing locale while analysis is pending discards the old-language result", async () => {
    gate = new Promise(resolve => { release = resolve; });
    const node = textElement("言語の変更を待ちます。"); drag(node);
    await until(() => analysisRequests().length === 1);
    useSettingsStore.setState(state => ({ settings: { ...state.settings, targetLanguage: "fr" } }));
    await until(() => lookup.querySelector(".hk-translation-text")?.textContent === `[fr] ${node.textContent}`);
    release!(); await sleep(30);
    assert(lookup.querySelector(".hk-translation-text")?.textContent === `[fr] ${node.textContent}`, "old-language result replaced the current result");
  }],
  ["Disabled analysis, popup interactions, ordinary clicks and Escape do not trigger selection requests", async () => {
    const node = textElement("無効な解析です。");
    useSettingsStore.setState(state => ({ settings: { ...state.settings, textAnalysisEnabled: false } }));
    await sleep(20); drag(node); await sleep(150);
    assert(analysisRequests().length === 0, "disabled analysis sent a request");
    useSettingsStore.setState(state => ({ settings: { ...state.settings, textAnalysisEnabled: true } }));
    await sleep(20); mouse(node, "mousedown", 10, 1); select(node); mouse(node, "mouseup", 10); await sleep(150);
    assert(analysisRequests().length === 0, "ordinary click analyzed an existing selection");
    drag(node); close(); await sleep(150);
    assert(analysisRequests().length === 0 && !lookup.querySelector(".hk-popup"), "Escape failed to cancel pending selection");
    drag(textElement("画面内を選択します。")); await until(() => !!lookup.querySelector(".hk-tokens--sentence"));
    requests.length = 0;
    drag(lookup.querySelector<HTMLElement>(".hk-tokens--sentence")!); await sleep(150);
    assert(analysisRequests().length === 0, "popup selection sent a request");
  }],
];

if (!new URLSearchParams(location.search).has("embedded")) tests.push([
  "The same selection checks pass inside a frame with its own document and selection",
  async () => {
    const frame = document.createElement("iframe"); frame.style.width = "100%"; frame.style.height = "700px";
    frame.src = `./selection.html?embedded${nativePanel ? "&native" : ""}`; fixture.replaceChildren(frame);
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve(); frame.onerror = () => reject(new Error("Frame could not load"));
    });
    // Wait for the child to run the complete gesture, shadow-root and locale suite.
    for (let i = 0; i < 1000; i++) {
      if (frame.contentDocument?.querySelector("#results")?.getAttribute("data-complete") === "true") break;
      await sleep(20);
    }
    assert(frame.contentDocument?.title === "All selection checks passed", frame.contentDocument?.querySelector("#results")?.textContent || "Frame checks timed out");
  },
]);

await sleep(30);
const lines: string[] = [];
try {
  for (const [name, run] of tests) {
    requests.length = 0;
    try { await run(); lines.push(`PASS ${name}`); }
    catch (error) { lines.push(`FAIL ${name}: ${error}`); }
    responseMode = "normal"; close(); await sleep(20);
    useSettingsStore.setState(state => ({ settings: { ...state.settings, targetLanguage: "en" } }));
    await sleep(20);
    window.getSelection()?.removeAllRanges(); fixture.replaceChildren();
    results.textContent = lines.join("\n");
  }
} finally {
  root.unmount(); globalThis.fetch = realFetch;
  const failed = lines.filter(line => line.startsWith("FAIL")).length;
  document.title = failed ? `${failed} selection checks failed` : "All selection checks passed";
  results.dataset.complete = "true";
}
