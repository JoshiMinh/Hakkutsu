import { analyzePageDensity } from "../src/features/analytics/page-analyzer";
import { densityContent, densityMutationRelevant } from "../src/features/analytics/density-content";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function runDensityBrowserTests() {
  const fixture = document.querySelector<HTMLElement>("#fixture")!;
  fixture.innerHTML = '<nav>学校'.repeat(1) + '</nav><p><span>学</span><ruby>校<rt>がっこう</rt></ruby> abc123 𠮷</p><aside>学校</aside><div style="display:none">日本</div><div style="visibility:hidden">日本</div><div contenteditable>日本</div><div class="hk-density-badge">日本</div>';
  const baseline = await analyzePageDensity(fixture);
  assert(baseline.totalJapaneseChars === 3 && baseline.totalTextChars === 9, "visible Unicode script denominator");
  assert(baseline.totalWords === 2 && baseline.uniqueWords === 2, "inline source stays contiguous");
  assert(baseline.totalKanji === 3 && baseline.uniqueKanji === 3, "supplementary kanji");
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(changes => records.push(...changes));
  observer.observe(fixture, {subtree:true,childList:true});
  fixture.querySelector("rt")!.textContent = "ながいふりがな";
  await Promise.resolve(); observer.disconnect();
  assert(records.every(record => !densityMutationRelevant(record)), "ruby readings do not invalidate density");
  const after = await analyzePageDensity(fixture);
  assert(after.totalJapaneseChars === baseline.totalJapaneseChars && after.totalWords === baseline.totalWords, "ruby invariance");
  const visibilityRecords: MutationRecord[] = [];
  const visibilityObserver = new MutationObserver(changes => visibilityRecords.push(...changes));
  visibilityObserver.observe(fixture, {subtree:true,attributes:true});
  fixture.querySelector("p")!.hidden = true;
  await Promise.resolve(); visibilityObserver.disconnect();
  assert(visibilityRecords.some(densityMutationRelevant), "hiding counted text invalidates analysis");
  assert((await analyzePageDensity(fixture)).totalJapaneseChars === 0, "newly hidden text is excluded");
  const controller = new AbortController(); controller.abort();
  let aborted = false;
  try { await analyzePageDensity(fixture, controller.signal); } catch (error) { aborted = (error as Error).name === "AbortError"; }
  assert(aborted, "obsolete analysis aborts");
  fixture.innerHTML = (`<p>${'学校。日本。小説を読む。'.repeat(10)}</p>`).repeat(1000);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const start = performance.now();
  try {
    const result = await analyzePageDensity(fixture);
    assert(result.totalWords >= 4000, "long chapter vocabulary");
    const repeat = await analyzePageDensity(fixture);
    assert(JSON.stringify(result) === JSON.stringify(repeat), "repeated scans are stable");
    const metric = document.createElement("pre"); metric.id = "density-metrics";
    metric.textContent = JSON.stringify({paragraphs:1000, words:result.totalWords, characters:result.totalJapaneseChars, twoScansMs:Math.round(performance.now()-start), heartbeatTicks:ticks});
    document.querySelector("#density-metrics")?.remove(); document.querySelector("#metrics")!.before(metric);
    assert(ticks > 0 || document.hidden, `long analysis yields to the event loop: ${metric.textContent}`);
  } finally { clearInterval(timer); fixture.replaceChildren(); }
  // Main-content extraction must ignore the fixture runner surrounding <main>.
  fixture.innerHTML = '<p>学校。</p>'.repeat(20);
  const article = await densityContent(document.body);
  assert(article.scope === "article" && article.texts.join("").replace(/\s/g,"") === "学校。".repeat(20), "semantic article scope");
  fixture.innerHTML = '<div class="p-novel__body"><div class="js-novel-text p-novel__text--preface">日本</div><div class="js-novel-text p-novel__text">学校</div><div class="js-novel-text p-novel__text--afterword">日本</div></div>';
  const chapter = await densityContent(document.body);
  assert(chapter.scope === "article" && chapter.texts.join("").trim() === "学校", "Syosetu excludes author preface and afterword");
  fixture.replaceChildren();
  const replacement = document.createElement("div");
  replacement.innerHTML = `<div><p>${"学校で小説を読む。".repeat(100)}</p></div>`;
  fixture.replaceWith(replacement);
  try {
    const extracted = await densityContent(document.body);
    assert(extracted.scope === "article" && extracted.texts.join("").includes("学校で小説を読む。".repeat(20)), "Readability fallback extracts an unmarked story");
    const saved = [...document.body.childNodes];
    document.body.replaceChildren();
    try {
      const page = await densityContent(document.body);
      assert(page.scope === "page" && page.texts.length === 0, "empty non-article page uses explicit page fallback");
    } finally { document.body.replaceChildren(...saved); }
  } finally { replacement.replaceWith(fixture); }
}
