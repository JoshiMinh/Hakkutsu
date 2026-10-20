import { injectSelectiveFurigana, removeSelectiveFurigana, shouldInjectForMode, splitFuriganaText } from "../src/features/analytics/furigana-injector";
import { resolveFuriganaTexts } from "../src/features/analytics/furigana-readings";
import { resolveDensityVocabulary } from "../src/features/analytics/density-vocabulary";
import { runDensityBrowserTests } from "./density.browser";
import { runDensityResponsiveTests } from "./density-responsive";
import { analyzePageDensity } from "../src/features/analytics/page-analyzer";
import { learnedVocabulary } from "../src/features/analytics/page-text";
import { distributeFurigana } from "../src/shared/japanese/japanese";
import type { DictEntry } from "../src/features/dictionary/local-lookup";
import { getDB } from "../src/features/dictionary/local-lookup";
import { importDictionary } from "../src/features/dictionary/dictionary-sync";
import { getHanViet } from "../src/shared/japanese/hanviet-dict";

const entries: Record<string, string> = { 学校: "がっこう", 日本: "にほん", 食べる: "たべる", 聞き返す: "ききかえす", 今日: "きょう", 一人: "ひとり", 小説: "しょうせつ", 投稿: "とうこう", 読む: "よむ" };
const fixture = document.querySelector<HTMLElement>("#fixture")!;
let requests = 0, lookups = 0;
let trackedCharacters = 0;
let learned: string[] = [];
let error = "";
let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
let densityRequests = 0;
let densityGate: Promise<void> | undefined;
let releaseDensity: (() => void) | undefined;
const lookup = async (word: string): Promise<DictEntry[]> => {
  lookups++;
  return entries[word] ? [{ id: word, kanjiElements: [word], readingElements: [entries[word]], senses: [], jlpt: "N5" }] : [];
};
const mockRuntime = {
  async sendMessage(message: { type: string; payload?: { texts: string[] } }) {
    if (message.type === "TRACK_CHARACTERS_READ") {
      trackedCharacters += (message.payload as unknown as {count:number}).count;
      return { type: "TRACK_CHARACTERS_READ_RESULT", payload: {} };
    }
    if (message.type === "GET_DENSITY_VOCABULARY") {
      densityRequests++;
      const wait = densityGate; densityGate = undefined;
      if (wait) await wait;
      return {type:"DENSITY_VOCABULARY_RESULT",payload:{words:await resolveDensityVocabulary(message.payload!.texts)}};
    }
    if (message.type === "GET_DENSITY_KNOWLEDGE") return {type:"DENSITY_KNOWLEDGE_RESULT",payload:{mature:learned.filter(word => word.length > 1),learning:[]}};
    if (message.type === "GET_LEARNED_VOCABULARY") return { type: "LEARNED_VOCABULARY_RESULT", payload: { words: learned } };
    if (message.type !== "GET_FURIGANA_READINGS") throw new Error(`Unexpected message: ${message.type}`);
    requests++;
    const wait = gate; gate = undefined;
    if (wait) await wait;
    if (error) return { type: "ERROR", payload: { error } };
    const texts = message.payload!.texts;
    assert(texts.length <= 8 && texts.every(text => text.length <= 2000), "IPC bounds");
    return { type: "FURIGANA_READINGS_RESULT", payload: { readings: await resolveFuriganaTexts(texts, lookup) } };
  },
};
const listener = { addListener() {}, removeListener() {} };
Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
  runtime: mockRuntime,
  storage: { sync: { async get() { return {}; }, async set() {}, async remove() {} }, onChanged: listener },
} });
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  const end = performance.now() + 4000;
  while (!condition()) { if (performance.now() > end) throw new Error("Timed out"); await sleep(10); }
}
function holdNext() { gate = new Promise(resolve => { release = resolve; }); }
function setup(html: string) { removeSelectiveFurigana(fixture); fixture.innerHTML = html; learned = []; error = ""; requests = 0; lookups = 0; }
const rubies = () => fixture.querySelectorAll(".hk-selective-ruby");
const reading = () => [...fixture.querySelectorAll(".hk-selective-ruby rt")].map(rt => rt.textContent);
const tests: Array<[string, () => Promise<void> | void]> = [
  ["Density content, metrics, cancellation and performance", runDensityBrowserTests],
  ["Density panel fits 320, 768, 1024 and 1440px", runDensityResponsiveTests],
  ["Actual definition cards repair partial Hán-Việt and honor its setting", async () => {
    const [{ createRoot }, { createElement }, { DefinitionCard }, { useSettingsStore }] = await Promise.all([
      import("react-dom/client"), import("react"), import("../src/features/dictionary/definition-card"), import("../src/features/settings/settings-store"),
    ]);
    const saved = useSettingsStore.getState().settings;
    useSettingsStore.setState({settings:{...saved,targetLanguage:"vi",showHanViet:true}});
    const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
    const render = (word: string, supplied?: string) => root.render(createElement(DefinitionCard, {
      // Disable unrelated network enrichment; this regression targets the actual header.
      token:{surface:word,dictionary_form:word,reading:{hiragana:"",romaji:""},pos:"Word",pos_detail:[],is_japanese:false,jlpt_level:null,frequency_rank:null,definitions:[],vietnamese_sound:supplied},
      originalText:word,sentenceReading:"",ankiConnected:false,hideBottomAction:true,
    }));
    try {
      render("便利","LỢI"); await until(() => mount.textContent!.includes("TIỆN LỢI"));
      render("連載"); await until(() => mount.textContent!.includes("LIÊN TẢI"));
      render("破棄"); await until(() => mount.textContent!.includes("PHÁ KHÍ"));
      render("破棄", "PHÁ"); await until(() => mount.textContent!.includes("PHÁ KHÍ"));
      equal(getHanViet("学校"),"HỌC HIỆU");
      useSettingsStore.setState({settings:{...saved,showHanViet:false}});
      await until(() => !mount.textContent!.includes("PHÁ KHÍ"));
    } finally { root.unmount(); mount.remove(); useSettingsStore.setState({settings:saved}); }
  }],
  ["Enable adds readings; disable restores exact text", async () => {
    setup("<p>  学校。日本！\n</p>"); const before = fixture.textContent;
    const result = await injectSelectiveFurigana("all", fixture);
    equal(result.cancelled, false); equal(reading(), ["がっこう", "にほん"]);
    equal(result.charactersRead, 0); removeSelectiveFurigana(fixture); equal(fixture.textContent, before);
  }],
  ["Existing nested ruby, code, hidden and editable content remain untouched", async () => {
    setup('<ruby><rb><span>学校</span></rb><rt>がっこう</rt></ruby><code><span>学校</span></code><div contenteditable><span>学校</span></div><div hidden>学校</div><p>日本</p>');
    const native = fixture.querySelector("ruby")!.outerHTML;
    await injectSelectiveFurigana("all", fixture); equal(rubies().length, 1);
    equal(fixture.querySelector("ruby")!.outerHTML, native);
  }],
  ["Every selective mode and mastered vocabulary", async () => {
    const known = new Set(["学校", "学", "校"]);
    equal(shouldInjectForMode("学校", "N5", "unlearned", known), false);
    equal(shouldInjectForMode("日本", "N5", "unlearned", known), true);
    for (const mode of ["n3_plus", "n2_plus", "n1_only"] as const) {
      equal(shouldInjectForMode("学校", "N5", mode, known), false);
      equal(shouldInjectForMode("学校", "N1", mode, known), true);
      equal(shouldInjectForMode("学校", "unranked", mode, known), true);
    }
    equal(shouldInjectForMode("学校", "N3", "n3_plus", known), true);
    equal(shouldInjectForMode("学校", "N3", "n2_plus", known), false);
    equal(shouldInjectForMode("学校", "N2", "n1_only", known), false);
    setup("<p>学校、日本。</p>"); learned = [...known];
    await injectSelectiveFurigana("unlearned", fixture); equal(reading(), ["にほん"]);
    assert(learnedVocabulary([{word:"学校",interval:21,repetition:0}]).includes("学"), "learned kanji consistency");
  }],
  ["Inflections, compounds, counters and irregular readings preserve source", async () => {
    setup("<p>食べた。聞き返す。今日、一人。小説を読む。</p>"); const before = fixture.textContent;
    await injectSelectiveFurigana("all", fixture);
    assert(reading().includes("た"), "inflected 食べた reading");
    assert(reading().includes("きょう"), "irregular 今日 reading");
    removeSelectiveFurigana(fixture); equal(fixture.textContent, before);
    equal(distributeFurigana("食べる", "のむ"), [{text:"食べる"}]);
  }],
  ["Unknown names stay unchanged", async () => {
    setup("<p>髙橋鶴見</p>"); await injectSelectiveFurigana("all", fixture); equal(rubies().length, 0);
  }],
  ["Cancellation during an outstanding request cannot write stale ruby", async () => {
    setup("<p>学校</p>"); holdNext(); const pending = injectSelectiveFurigana("all", fixture);
    await until(() => requests === 1); removeSelectiveFurigana(fixture); release!();
    equal((await pending).cancelled, true); equal(rubies().length, 0); equal(fixture.textContent, "学校");
  }],
  ["Newer mode wins when the previous request finishes late", async () => {
    setup("<p>学校</p>"); holdNext(); const old = injectSelectiveFurigana("all", fixture);
    await until(() => requests === 1);
    const current = await injectSelectiveFurigana("n1_only", fixture);
    release!(); equal((await old).cancelled, true); equal(current.cancelled, false); equal(rubies().length, 0);
    fixture.insertAdjacentHTML("beforeend", "<p>日本</p>"); await sleep(250); equal(rubies().length, 0);
  }],
  ["Edits during lookup are rescanned without overwriting the new text", async () => {
    setup("<p>学校</p>"); holdNext(); const pending = injectSelectiveFurigana("all", fixture);
    await until(() => requests === 1); fixture.querySelector("p")!.firstChild!.textContent = "日本";
    release!(); await pending; await until(() => reading().includes("にほん"));
    removeSelectiveFurigana(fixture); equal(fixture.textContent, "日本");
  }],
  ["Dynamic additions are annotated once and reuse cached paragraphs", async () => {
    setup("<p>学校</p>"); await injectSelectiveFurigana("all", fixture); const initial = requests;
    fixture.insertAdjacentHTML("beforeend", "<p>学校</p>"); await until(() => rubies().length === 2);
    await sleep(200); equal(requests, initial);
    removeSelectiveFurigana(fixture); fixture.insertAdjacentHTML("beforeend", "<p>日本</p>");
    await sleep(200); equal(rubies().length, 0);
  }],
  ["Missing dictionary errors clean up and permit retry", async () => {
    setup("<p>学校</p>"); error = "Install a local dictionary";
    let rejected = false; try { await injectSelectiveFurigana("all", fixture); } catch { rejected = true; }
    assert(rejected, "must reject"); equal(rubies().length, 0); error = "";
    await injectSelectiveFurigana("all", fixture); equal(rubies().length, 1);
  }],
  ["Density is unchanged by injected readings and uses exact vocabulary", async () => {
    setup("<p>学校、日本。</p><ruby>今日<rt>きょう</rt></ruby>"); learned = ["学校", "学", "校"];
    const before = await analyzePageDensity(fixture); await injectSelectiveFurigana("all", fixture);
    const after = await analyzePageDensity(fixture);
    equal(after.totalJapaneseChars, before.totalJapaneseChars); equal(after.totalKanji, 6); equal(after.familiarity.mature, 1); equal(after.familiarity.notSaved, 2); equal(after.totalWords, 3);
  }],
  ["Long text chunks preserve whitespace and Unicode", () => {
    const text = " 学校。\n".repeat(1200) + "a".repeat(1799) + "𠮷学校";
    const chunks = splitFuriganaText(text); equal(chunks.join(""), text);
    assert(chunks.every(chunk => chunk.length <= 2000 && !/[\uD800-\uDBFF]$/u.test(chunk)), "safe bounded chunks");
  }],
  ["Repeated words cache successful and missing lookups", async () => {
    const counts = new Map<string, number>();
    await resolveFuriganaTexts(["学校。学校。鶴見。鶴見。"], async word => {
      counts.set(word, (counts.get(word) || 0) + 1); return lookup(word);
    });
    assert([...counts.values()].every(count => count === 1), "each lookup at most once per batch");
  }],
  ["Real IndexedDB import validates the entire file before writing", async () => {
    const db = await getDB(); const id = `furigana-test-${Date.now()}`;
    const before = await db.count("jmdict");
    const entry = { id, kanjiElements:["学校"], readingElements:["がっこう"], senses:[] };
    try {
      let failed = false;
      try { await importDictionary([entry, {...entry,id:`${id}-invalid`,readingElements:[]}]); }
      catch { failed = true; }
      assert(failed, "invalid file rejected"); equal(await db.count("jmdict"), before);
      equal(await importDictionary([entry]),before + 1);
      equal((await db.get("jmdict",id)).readingElements,["がっこう"]);
    } finally { await db.delete("jmdict",id); }
  }],
  ["Real badge handles failure, retry, cancel and rescan without duplicate analytics", async () => {
    setup("<p>学校</p>"); trackedCharacters = 0;
    const [{ createRoot }, { createElement }, { ImmersionDensityBadge }] = await Promise.all([
      import("react-dom/client"), import("react"), import("../src/features/analytics/immersion-density-badge"),
    ]);
    const host = document.createElement("hakkutsu-inline-dictionary-host");
    document.body.append(host); const shadow = host.attachShadow({mode:"open"}); const mount = document.createElement("div"); shadow.append(mount);
    const root = createRoot(mount); root.render(createElement(ImmersionDensityBadge));
    try {
      await until(() => !!shadow.querySelector("button[aria-expanded]"));
      (shadow.querySelector("button[aria-expanded]") as HTMLButtonElement).click();
      await until(() => !!shadow.querySelector("button[aria-pressed]"));
      const toggle = () => shadow.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
      error = "Install a local dictionary"; toggle().click();
      await until(() => !!shadow.querySelector("[role='alert']")); equal(toggle().getAttribute("aria-pressed"),"false");
      error = ""; toggle().click(); await until(() => toggle().getAttribute("aria-pressed") === "true");
      const initial = trackedCharacters;
      const refresh = [...shadow.querySelectorAll<HTMLButtonElement>("button")].find(button => /Rescan|Quét lại/.test(button.textContent || ""))!;
      refresh.click(); await sleep(100); equal(trackedCharacters,initial);
      // A slow obsolete request cannot overwrite a newer content snapshot.
      densityGate = new Promise(resolve => {releaseDensity = resolve;});
      const initialDensityRequests = densityRequests; refresh.click();
      await until(() => densityRequests > initialDensityRequests);
      fixture.insertAdjacentHTML("beforeend", "<p>日本</p>");
      const wordCount = () => shadow.querySelector(".hk-difficulty__trigger-count")?.textContent || "";
      await until(() => /2 (words|từ)/u.test(wordCount()));
      releaseDensity!(); await sleep(100);
      assert(/2 (words|từ)/u.test(wordCount()), "late density request ignored");
      fixture.querySelector("p")!.hidden = true;
      await until(() => /1 (words|từ)/u.test(wordCount()));
      fixture.querySelector("p")!.hidden = false;
      await until(() => /2 (words|từ)/u.test(wordCount()));
      const originalUrl = location.href;
      const beforeNavigation = densityRequests;
      history.pushState({}, "", "#density-navigation");
      await until(() => densityRequests > beforeNavigation && !!toggle());
      const beforeRestore = densityRequests;
      history.replaceState({}, "", originalUrl);
      await until(() => densityRequests > beforeRestore && !!toggle());
      toggle().click(); await until(() => toggle().getAttribute("aria-pressed") === "false"); equal(rubies().length,0);
      holdNext(); const initialRequests = requests; toggle().click(); await until(() => requests > initialRequests);
      toggle().click(); release!(); await sleep(100); equal(toggle().getAttribute("aria-pressed"),"false"); equal(rubies().length,0);
      document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,composed:true}));
      await until(() => !shadow.querySelector("[role='dialog']"));
      assert(shadow.activeElement === shadow.querySelector("button[aria-expanded]"), "Escape restores trigger focus");
      (shadow.querySelector("button[aria-expanded]") as HTMLButtonElement).click();
      await until(() => !!shadow.querySelector("[role='dialog']"));
      document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,composed:true}));
      await until(() => !shadow.querySelector("[role='dialog']"));
    } finally { root.unmount(); host.remove(); }
  }],
  ["Dictionary Settings shows import errors and accepts a valid local file", async () => {
    const [{ createRoot }, { createElement }, { DictionarySettings }] = await Promise.all([
      import("react-dom/client"), import("react"), import("../src/features/settings/dictionary-settings"),
    ]);
    const mount = document.createElement("div"); document.body.append(mount);
    const root = createRoot(mount); root.render(createElement(DictionarySettings, {language:"en"}));
    const db = await getDB(); const id = `settings-import-test-${Date.now()}`;
    const choose = (contents: string) => {
      const input = mount.querySelector<HTMLInputElement>("input[type='file']")!;
      const transfer = new DataTransfer(); transfer.items.add(new File([contents],"dictionary.json",{type:"application/json"}));
      input.files = transfer.files; input.dispatchEvent(new Event("change",{bubbles:true}));
    };
    try {
      await until(() => !!mount.querySelector("input"));
      choose("invalid JSON"); await until(() => !!mount.querySelector("[role='alert']"));
      choose(JSON.stringify([{id,kanjiElements:["学校"],readingElements:["がっこう"],senses:[]}]));
      await until(() => !mount.querySelector<HTMLInputElement>("input")!.disabled && !mount.querySelector("[role='alert']"));
      assert(await db.get("jmdict",id), "file was imported into real IndexedDB");
      assert(mount.querySelector("[role='status']")!.textContent!.includes("entries installed"), "success status");
    } finally { root.unmount(); mount.remove(); await db.delete("jmdict",id); }
  }],
  ["Long chapter benchmark stays responsive and restores text", async () => {
    setup("<p>学校。日本。小説を読む。</p>".repeat(1000)); const before = fixture.textContent;
    let ticks = 0; const heartbeat = setInterval(() => ticks++, 10);
    let firstRubyMs = 0; const start = performance.now();
    const observer = new MutationObserver(() => { if (!firstRubyMs && rubies().length) firstRubyMs = performance.now() - start; });
    observer.observe(fixture, { subtree: true, childList: true });
    const longTasks: number[] = [];
    const monitor = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration))) : null;
    monitor?.observe({ entryTypes: ["longtask"] });
    try {
      const result = await injectSelectiveFurigana("all", fixture);
      const elapsedMs = performance.now() - start;
      assert(result.injectedRubies >= 3000, "chapter annotated");
      const count = rubies().length; const removalStart = performance.now(); removeSelectiveFurigana(fixture);
      const removalMs = performance.now() - removalStart; equal(fixture.textContent, before);
      document.querySelector("#metrics")!.textContent = JSON.stringify({paragraphs:1000,characters:before!.length,rubies:count,requests,lookups,firstRubyMs:Math.round(firstRubyMs),elapsedMs:Math.round(elapsedMs),removalMs:Math.round(removalMs),heartbeatTicks:ticks,visibility:document.visibilityState,longTasks:longTasks.map(Math.round)},null,2);
      // Background tabs throttle timers; only require timer progress in a visible tab.
      assert(ticks > 0 || document.hidden, "event loop yielded");
    } finally { clearInterval(heartbeat); observer.disconnect(); monitor?.disconnect(); }
  }],
];

document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>("#run")!; button.disabled = true;
  document.querySelector("#results")!.replaceChildren(); let passed = 0;
  for (const [name, run] of tests) {
    document.querySelector("#summary")!.textContent = `Running: ${name}`;
    const row = document.createElement("li");
    try { await run(); passed++; row.textContent = `PASS: ${name}`; row.className = "pass"; }
    catch (error) { row.textContent = `FAIL: ${name}: ${error}`; row.className = "fail"; console.error(error); }
    finally { removeSelectiveFurigana(fixture); }
    document.querySelector("#results")!.append(row);
  }
  document.querySelector("#summary")!.textContent = `${passed}/${tests.length} passed`;
  fixture.innerHTML = "<p>学校で小説を読む。</p>"; await injectSelectiveFurigana("all", fixture);
  button.disabled = false;
};
