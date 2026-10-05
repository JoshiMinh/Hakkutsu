/**
 * AnkiConnect client for creating flashcards.
 *
 * Communicates with the AnkiConnect add-on running locally
 * on port 8765 via HTTP POST requests.
 */

import { ANKI_CONNECT_URL, ANKI_CONNECT_VERSION } from "~lib/utils/constants";
import type {
  AnkiConnectRequest,
  AnkiConnectResponse,
  AnkiNote,
  AnkiExportData,
} from "~lib/utils/types";

import { getSettings } from "~lib/services/storage";
import { inferAnkiFieldMapping } from "./anki-fields";
import { distributeFurigana } from "~lib/utils/japanese";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function furiganaHtml(value: string, reading?: string): string {
  if (/<ruby[\s>]/i.test(value)) return value;
  const render = (text: string, kana?: string) => distributeFurigana(text, kana).map(segment =>
    segment.ruby ? `<ruby>${escapeHtml(segment.text)}<rt>${escapeHtml(segment.ruby)}</rt></ruby>` : escapeHtml(segment.text)).join("");
  if (reading) return render(value, reading);
  // Saved SRS cards use Word[reading]; popup exports may already contain ruby HTML.
  const pattern = /([\u3041-\u30fa\u3400-\u9fff々ー]+)\[([\u3041-\u30faー]+)\]/gu;
  let result = "", offset = 0;
  for (const match of value.matchAll(pattern)) {
    result += escapeHtml(value.slice(offset, match.index)) + render(match[1], match[2]);
    offset = match.index! + match[0].length;
  }
  return result + escapeHtml(value.slice(offset));
}

class AnkiConnectClient {
  private url: string;

  constructor(url: string = ANKI_CONNECT_URL) {
    this.url = url;
  }

  private async stringList(action: string, params?: Record<string, unknown>): Promise<string[]> {
    const values = await this.invoke(action, params);
    if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error(`Invalid ${action} response from AnkiConnect.`);
    }
    return values;
  }

  /** Send a request to AnkiConnect */
  private async invoke(
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    if ((await getSettings()).ankiEnabled === false) {
      throw new Error("AnkiConnect is disabled in settings.");
    }
    const request: AnkiConnectRequest = {
      action,
      version: ANKI_CONNECT_VERSION,
      ...(params ? { params } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let response: Response;
      try {
        response = await fetch(this.url, { method: "POST", body: JSON.stringify(request), signal: controller.signal });
      } catch {
        if (controller.signal.aborted) throw new Error("AnkiConnect timed out. Check that Anki is open, then retry.");
        throw new Error(`AnkiConnect connection failed: Cannot reach Anki at ${this.url}. Please make sure Anki app is open with the AnkiConnect add-on enabled.`);
      }
      if (!response.ok) throw new Error(`AnkiConnect HTTP error (${response.status}): ${response.statusText}`);
      let data: AnkiConnectResponse;
      try { data = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new Error("AnkiConnect timed out. Check that Anki is open, then retry.");
        throw new Error("Invalid JSON response from AnkiConnect.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || !("result" in data) ||
        !("error" in data) || (data.error !== null && typeof data.error !== "string")) {
        throw new Error("Invalid response from AnkiConnect: expected result and error fields.");
      }
      if (data.error) throw new Error(`AnkiConnect error: ${data.error}`);
      return data.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Check if AnkiConnect is reachable */
  async isConnected(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch {
      return false;
    }
  }

  /** Get AnkiConnect version */
  async getVersion(): Promise<number> {
    const version = await this.invoke("version");
    if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) throw new Error("Invalid AnkiConnect version response.");
    return version;
  }

  /** List all deck names */
  async getDecks(): Promise<string[]> {
    return this.stringList("deckNames");
  }

  /** List all model (note type) names */
  async getModels(): Promise<string[]> {
    return this.stringList("modelNames");
  }

  /** Get field names for a model */
  async getModelFields(modelName: string): Promise<string[]> {
    return this.stringList("modelFieldNames", { modelName });
  }

  /** Create a new deck if it doesn't exist */
  async createDeck(deckName: string): Promise<number> {
    const id = await this.invoke("createDeck", { deck: deckName });
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("AnkiConnect did not return a valid deck ID.");
    return id;
  }

  /** Add a note to Anki */
  async addNote(note: AnkiNote): Promise<number> {
    const result = await this.invoke("addNote", { note });
    if (result === null || result === undefined) {
      throw new Error(`Anki rejected adding card "${note.fields.Word || note.fields.Front || ''}". It may already exist as a duplicate in deck "${note.deckName}".`);
    }
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result <= 0) throw new Error("AnkiConnect did not return a valid note ID.");
    return result;
  }

  /**
   * Export a vocabulary entry to Anki using Hakkutsu's card format or custom field map.
   */
  async exportVocabulary(
    data: AnkiExportData,
    deckName: string = "Hakkutsu",
    modelName: string = "Basic",
    fieldMap?: Record<string, string>
  ): Promise<number> {
    if (typeof data?.word !== "string" || !data.word.trim()) throw new Error("Choose a vocabulary word before exporting to Anki.");
    const targetDeck = (deckName && deckName.trim()) || "Hakkutsu";
    const targetModel = (modelName && modelName.trim()) || "Basic";

    const modelFields = await this.getModelFields(targetModel);
    if (modelFields.length === 0) throw new Error(`Anki note type "${targetModel}" has no fields.`);

    const imgHtml = data.imageUrl
      ? `<div class="illustration" style="margin-top: 10px; text-align: center;"><img src="${escapeHtml(data.imageUrl)}" style="max-width: 280px; border-radius: 8px;" /></div>`
      : "";

    const frontHtml = `<div class="hakkutsu-card">
  <div class="word">${escapeHtml(data.word)}</div>
  <div class="reading">${escapeHtml(data.reading)}</div>
  ${data.jlptLevel ? `<div class="jlpt">${escapeHtml(data.jlptLevel)}</div>` : ""}
</div>`;

    const backHtml = `<div class="hakkutsu-card">
  <div class="meaning">${escapeHtml(data.meaning)}</div>
  <div class="pos">${escapeHtml(data.pos)}</div>
  ${data.sentence ? `<div class="sentence">${escapeHtml(data.sentence)}</div>` : ""}
  ${data.sentenceReading ? `<div class="sentence-reading">${escapeHtml(data.sentenceReading)}</div>` : ""}
  ${data.sentenceMeaning ? `<div class="sentence-meaning">${escapeHtml(data.sentenceMeaning)}</div>` : ""}
  ${data.sourceUrl ? `<div class="source-link" style="margin-top: 8px; font-size: 11px;"><a href="${escapeHtml(data.sourceUrl)}" target="_blank">Video Context</a></div>` : ""}
  ${data.screenshot ? `<div class="screenshot" style="margin-top: 10px;"><img src="${escapeHtml(data.screenshot)}" style="max-width: 100%; border-radius: 8px;" /></div>` : ""}
  ${imgHtml}
</div>`;

    const getValueForChoice = (choice: string): string => {
      switch (choice) {
        case "word": return escapeHtml(data.word);
        case "reading": return escapeHtml(data.reading);
        case "wordFurigana": return furiganaHtml(data.wordFurigana || data.word,
          !data.wordFurigana || data.wordFurigana === data.word ? data.reading : undefined);
        case "meaning": return escapeHtml(data.meaning);
        case "vietnameseSound": return escapeHtml(data.vietnameseSound || "");
        case "sentence": return escapeHtml(data.sentence || "");
        case "sentenceFurigana": return furiganaHtml(data.sentenceFurigana || data.sentence || "");
        case "sentenceReading": return escapeHtml(data.sentenceReading || "");
        case "sentenceMeaning": return escapeHtml(data.sentenceMeaning || "");
        case "jlptLevel": return escapeHtml(data.jlptLevel || "");
        case "pos": return escapeHtml(data.pos || "");
        case "imageUrl": return data.imageUrl ? `<img src="${escapeHtml(data.imageUrl)}" />` : "";
        case "screenshot": return data.screenshot ? `<img src="${escapeHtml(data.screenshot)}" />` : "";
        case "sourceUrl": return data.sourceUrl ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank">Video Context</a>` : "";
        case "audio": return data.audio || "";
        case "sentenceAudio": return data.sentenceAudio || "";
        case "frontHtml": return frontHtml;
        case "backHtml": return backHtml;
        case "none": return "";
        default: throw new Error(`Unknown Anki field mapping: ${choice}. Update your Anki settings.`);
      }
    };

    const fields: Record<string, string> = Object.create(null);
    const customFields = Object.keys(fieldMap || {});
    for (const key of customFields) {
      if (fieldMap![key] && fieldMap![key] !== "none" && !modelFields.some(field => field.toLowerCase() === key.toLowerCase())) {
        throw new Error(`Mapped field "${key}" is not in Anki note type "${targetModel}". Update your Anki field mappings.`);
      }
    }
    for (const field of modelFields) {
      const key = customFields.find(key => key.toLowerCase() === field.toLowerCase());
      const choice = customFields.length ? (key ? fieldMap![key] || "none" : "none") : inferAnkiFieldMapping(field);
      fields[field] = getValueForChoice(choice);
    }
    if (!fields[modelFields[0]].trim()) {
      throw new Error(`The first field "${modelFields[0]}" is empty. Map it to Word or Front HTML in Anki settings.`);
    }
    // Validate the note type and mappings before creating a deck or adding a note.
    await this.createDeck(targetDeck);

    const note: AnkiNote = {
      deckName: targetDeck,
      modelName: targetModel,
      fields,
      options: { allowDuplicate: false },
      tags: ["hakkutsu", data.jlptLevel || "unranked"].filter(Boolean),
    };

    return this.addNote(note);
  }
}

/** Singleton instance */
export const ankiClient = new AnkiConnectClient();
