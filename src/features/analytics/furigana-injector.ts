import { hasKanji, isKanji, distributeFurigana } from "~/shared/japanese/japanese";
import { predictJlpt } from "~/shared/japanese/jlpt-classifier";
import type { SelectiveFuriganaMode } from "~/features/settings/types";
import type { FuriganaWord } from "./furigana-readings";
import { eligiblePageText, pageTextWalker, yieldToPage } from "./page-text";

const RUBY_CLASS = "hk-selective-ruby";
interface Session {
  root: Element;
  controller: AbortController;
  observer: MutationObserver;
  timer?: ReturnType<typeof setTimeout>;
  pending: Set<Node>;
  processed: WeakMap<Text, string>;
  cache: Map<string, FuriganaWord[]>;
  running: boolean;
}
let active: Session | null = null;

export function removeSelectiveFurigana(root: Element = active?.root || document.body): number {
  if (active) {
    active.controller.abort();
    active.observer.disconnect();
    clearTimeout(active.timer);
    active.pending.clear();
    active = null;
  }
  const parents = new Set<Node>();
  const rubies = Array.from(root.querySelectorAll<HTMLElement>(`.${RUBY_CLASS}`));
  for (const ruby of rubies) {
    const parent = ruby.parentNode;
    if (!parent) continue;
    const text = Array.from(ruby.childNodes)
      .filter(child => child.nodeType !== Node.ELEMENT_NODE || (child as Element).tagName !== "RT")
      .map(child => child.textContent || "").join("");
    parent.replaceChild(document.createTextNode(text), ruby);
    parents.add(parent);
  }
  for (const parent of parents) parent.normalize();
  return rubies.length;
}

export function shouldInjectForMode(surface: string, jlpt: string | null | undefined,
  mode: SelectiveFuriganaMode, learned: Set<string>): boolean {
  if (!hasKanji(surface)) return false;
  if (mode === "all") return true;
  if (mode === "unlearned") {
    return !learned.has(surface.toLowerCase()) && [...surface].some(char => isKanji(char) && !learned.has(char));
  }
  const level = (jlpt || predictJlpt(surface) || "unranked").toUpperCase().replace("JLPT-", "");
  const allowed = mode === "n3_plus" ? ["N3", "N2", "N1", "UNRANKED"]
    : mode === "n2_plus" ? ["N2", "N1", "UNRANKED"] : ["N1", "UNRANKED"];
  return allowed.includes(level);
}

async function request<T>(type: string, payload?: unknown): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, payload });
  if (!result || result.type === "ERROR") throw new Error(result?.payload?.error || "Furigana service is unavailable.");
  return result.payload as T;
}

// Bound messages without losing whitespace, punctuation, or surrogate pairs.
export function splitFuriganaText(text: string): string[] {
  const chunks: string[] = [];
  while (text.length > 1800) {
    let end = Math.max(text.lastIndexOf("。", 1800), text.lastIndexOf("\n", 1800));
    end = end > 900 ? end + 1 : 1800;
    if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

export async function injectSelectiveFurigana(
  mode: SelectiveFuriganaMode = "unlearned", root: Element = document.body,
  onError?: (error: Error) => void,
): Promise<{ processedNodes: number; injectedRubies: number; charactersRead: number; cancelled: boolean }> {
  // Cleanup belongs to the previous generation, before the new controller exists.
  removeSelectiveFurigana();
  const controller = new AbortController();
  const signal = controller.signal;
  let processedNodes = 0;
  let injectedRubies = 0;
  let learned = new Set<string>();
  const session: Session = {
    root, controller, pending: new Set(), processed: new WeakMap(), cache: new Map(), running: true,
    observer: new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") session.pending.add(record.target);
        else for (const node of record.addedNodes) session.pending.add(node);
      }
      schedule();
    }),
  };
  active = session;

  function schedule() {
    if (signal.aborted || session.running || session.timer || !session.pending.size) return;
    session.timer = setTimeout(() => {
      session.timer = undefined;
      session.running = true;
      const roots = [...session.pending];
      session.pending.clear();
      void process(roots).catch(error => {
        if (!signal.aborted) { removeSelectiveFurigana(root); onError?.(error); }
      }).finally(() => { session.running = false; schedule(); });
    }, 80);
  }

  async function process(roots: Node[]) {
    const targets = new Set<Text>();
    let deadline = performance.now() + 6;
    for (const subtree of roots) {
      if (!root.contains(subtree)) continue;
      const add = (node: Node) => {
        if (eligiblePageText(node) && hasKanji(node.data) && session.processed.get(node) !== node.data) targets.add(node);
      };
      if (subtree.nodeType === Node.TEXT_NODE) add(subtree);
      else {
        const walker = pageTextWalker(subtree);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (signal.aborted) return;
          add(node);
          if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
        }
      }
    }
    // One layout read per parent, before writes. Prioritize the visible viewport.
    const visible = new Map<Element, boolean>();
    const near: Text[] = [], later: Text[] = [];
    for (const node of targets) {
      if (signal.aborted) return;
      const parent = node.parentElement;
      if (!parent || !root.contains(node)) continue;
      if (!visible.has(parent)) {
        const rect = parent.getBoundingClientRect();
        visible.set(parent, rect.bottom >= 0 && rect.top <= window.innerHeight);
      }
      (visible.get(parent) ? near : later).push(node);
      if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
    }
    const nodes = [...near, ...later];
    for (let start = 0; start < nodes.length && !signal.aborted; start += 8) {
      const batch = nodes.slice(start, start + 8).map(node => ({ node, text: node.data }));
      const missing = [...new Set(batch.flatMap(item => splitFuriganaText(item.text)).filter(text => !session.cache.has(text)))];
      const resolved = new Map<string, FuriganaWord[]>();
      for (let i = 0; i < missing.length && !signal.aborted; i += 8) {
        const texts = missing.slice(i, i + 8);
        const { readings } = await request<{ readings: FuriganaWord[][] }>("GET_FURIGANA_READINGS", { texts });
        if (signal.aborted) return;
        if (!Array.isArray(readings) || readings.length !== texts.length) throw new Error("Invalid furigana response.");
        texts.forEach((text, index) => {
          const words = readings[index];
          if (!Array.isArray(words) || words.map(word => word.text).join("") !== text) throw new Error("Furigana response changed the source text.");
          resolved.set(text, words);
        });
        await yieldToPage();
      }
      for (const item of batch) {
        if (signal.aborted) return;
        if (!root.contains(item.node) || !eligiblePageText(item.node) || item.node.data !== item.text) continue;
        const fragment = document.createDocumentFragment();
        let added = 0;
        for (const text of splitFuriganaText(item.text)) {
          for (const word of resolved.get(text) || session.cache.get(text) || [{ text }]) {
            const parts = shouldInjectForMode(word.text, word.jlpt, mode, learned)
              ? distributeFurigana(word.text, word.reading) : [{ text: word.text }];
            for (const part of parts) {
              if ("ruby" in part && part.ruby) {
                const ruby = document.createElement("ruby");
                ruby.className = RUBY_CLASS;
                ruby.style.rubyPosition = "over";
                const rt = document.createElement("rt");
                rt.className = "hk-selective-rt";
                rt.style.cssText = "font-size:0.62em;color:inherit;user-select:none";
                rt.textContent = part.ruby;
                ruby.append(document.createTextNode(part.text), rt);
                fragment.append(ruby);
                added++;
              } else {
                const plain = document.createTextNode(part.text);
                session.processed.set(plain, part.text);
                fragment.append(plain);
              }
            }
          }
        }
        session.processed.set(item.node, item.text);
        if (added) item.node.replaceWith(fragment);
        processedNodes++;
        injectedRubies += added;
        if (performance.now() > deadline) { await yieldToPage(); deadline = performance.now() + 6; }
      }
      for (const [text, words] of resolved) {
        if (session.cache.size >= 256) session.cache.delete(session.cache.keys().next().value!);
        session.cache.set(text, words);
      }
      await yieldToPage();
    }
  }

  try {
    if (mode === "unlearned") {
      const { words } = await request<{ words: string[] }>("GET_LEARNED_VOCABULARY");
      learned = new Set(words);
    }
    if (!signal.aborted) {
      session.observer.observe(root, { subtree: true, childList: true, characterData: true });
      await process([root]);
    }
  } catch (error) {
    if (!signal.aborted) { removeSelectiveFurigana(root); throw error; }
  } finally {
    session.running = false;
    schedule();
  }
  return { processedNodes, injectedRubies, charactersRead: 0, cancelled: signal.aborted };
}
