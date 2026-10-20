import { Readability } from "@mozilla/readability";
import { yieldToPage } from "./page-text";
import type { PageDensityAnalysis } from "./types";

const EXCLUDED = "script,style,noscript,textarea,input,select,button,code,pre,svg,canvas,audio,video,iframe,rt,rp,nav,aside,footer,[role=navigation],[role=complementary],[hidden],[aria-hidden=true],[contenteditable]:not([contenteditable=false]),.hk-popup,.hk-density-badge,hakkutsu-inline-dictionary-host,#hakkutsu-inline-dictionary-host";
const BLOCK = /^(ADDRESS|ARTICLE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|H[1-6]|HR|LI|MAIN|OL|P|SECTION|TABLE|TD|TH|TR|UL)$/;
export function checkDensityAbort(signal?: AbortSignal) { signal?.throwIfAborted(); }

function visible(element: Element): boolean {
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.matches(EXCLUDED)) return false;
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || style.getPropertyValue("content-visibility") === "hidden") return false;
  }
  return true;
}

/** Filter live computed styles before extracting from an inert clone. */
export async function densityContent(root: Element, signal?: AbortSignal): Promise<{ texts: string[]; scope: PageDensityAnalysis["scope"] }> {
  let scope: PageDensityAnalysis["scope"] = root === document.body ? "page" : "selection";
  let source = root;
  if (scope === "page") {
    const chapterText = [...root.querySelectorAll("#novel_honbun, .p-novel__body .js-novel-text:not(.p-novel__text--preface):not(.p-novel__text--afterword)")].find(visible);
    const chapter = chapterText || [...root.querySelectorAll(".p-novel__body")].find(visible);
    const articles = [...root.querySelectorAll("article")].filter(visible);
    const candidates = articles.length ? articles : [...root.querySelectorAll("main, [role=main]")].filter(visible);
    const semantic = candidates.sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];
    if (chapter || semantic) { source = chapter || semantic; scope = "article"; }
  }
  const doc = document.implementation.createHTMLDocument("");
  const container = doc.createElement("div"); doc.body.append(container);
  if (!visible(source)) return { texts: [], scope };
  const stack: Array<{ source: Node; target: Node }> = [{ source, target: container }];
  let deadline = performance.now() + 6;
  while (stack.length) {
    checkDensityAbort(signal);
    const item = stack.pop()!;
    const node = item.source;
    if (node.nodeType === Node.TEXT_NODE) item.target.appendChild(doc.createTextNode(node.nodeValue || ""));
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (element.matches(EXCLUDED)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || style.getPropertyValue("content-visibility") === "hidden") continue;
      const clone = doc.createElement(element.tagName.toLowerCase());
      clone.className = element.getAttribute("class") || "";
      item.target.appendChild(clone);
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ source: node.childNodes[index], target: clone });
    }
    if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
  }
  let extracted: Node = container;
  if (scope === "page") {
    try {
      const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 100, disableJSONLD: true, serializer: element => element }).parse();
      if (article?.content) { extracted = article.content as unknown as Node; scope = "article"; }
    } catch { /* Fall back to the sanitized visible page. */ }
  }
  // Inline spans/ruby bases retain adjacency; blocks never form compounds.
  const pieces: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) pieces.push(node.nodeValue || "");
    else {
      const block = node.nodeType === Node.ELEMENT_NODE && BLOCK.test((node as Element).tagName);
      if (block) pieces.push("\n");
      for (const child of node.childNodes) walk(child);
      if (block) pieces.push("\n");
    }
  };
  walk(extracted); checkDensityAbort(signal);
  return { texts: pieces.join("").split(/\n+/).filter(text => text.trim()), scope };
}

function baseText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE || (node as Element).matches(EXCLUDED)) return "";
  return [...node.childNodes].map(baseText).join("");
}

/** Wrapping/unwrapping ruby and updating extension UI are not content edits. */
export function densityMutationRelevant(record: MutationRecord): boolean {
  const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
  if (record.type === "attributes") {
    // Evaluate visibility-changing attributes even after the target became hidden.
    return !element?.closest(EXCLUDED.replace(",[hidden],[aria-hidden=true]", ""));
  }
  if (element?.closest(EXCLUDED)) return false;
  if (record.type === "childList") return [...record.addedNodes].map(baseText).join("") !== [...record.removedNodes].map(baseText).join("");
  return true;
}
