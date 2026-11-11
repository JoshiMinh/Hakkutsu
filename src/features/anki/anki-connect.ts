/**
 * AnkiConnect client for creating flashcards.
 *
 * Communicates with the AnkiConnect add-on running locally
 * on port 8765 via HTTP POST requests.
 */

import { ANKI_CONNECT_URL, ANKI_CONNECT_VERSION } from "~/features/anki/constants";
import type { AnkiConnectRequest, AnkiConnectResponse, AnkiNote, AnkiExportData } from "~/features/anki/types";

import { getSettings } from "~/features/settings/settings-storage";
import { inferAnkiFieldMapping } from "./anki-fields";
import { escapeHtml, furiganaHtml, richText, normalizeJlpt } from "./japanese-schema";
import type { RemoteCard, RemoteNote } from "./sync-types";

export class AnkiConnectError extends Error {
  constructor(message: string, public definiteFailure = false) { super(message); }
}

export class AnkiConnectClient {
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
      if (data.error) throw new AnkiConnectError(`AnkiConnect error: ${data.error}`, true);
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

  async getProfile(): Promise<string> {
    const profile = await this.invoke("getActiveProfile");
    if (typeof profile !== "string" || !profile) throw new Error("Anki did not identify the active profile.");
    return profile;
  }

  async getDeckIds(): Promise<Record<string, number>> {
    const result = await this.invoke("deckNamesAndIds");
    if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.values(result).some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) throw new Error("Invalid Anki deck identities.");
    return result as Record<string, number>;
  }

  async findNotes(query: string): Promise<number[]> { return this.ids("findNotes", { query }); }
  async findCards(query: string): Promise<number[]> { return this.ids("findCards", { query }); }
  private async ids(action: string, params: Record<string, unknown>): Promise<number[]> {
    const ids = await this.invoke(action, params);
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(`Invalid ${action} response.`);
    return ids;
  }

  async notesInfo(notes: number[]): Promise<RemoteNote[]> {
    if (!notes.length) return [];
    const result = await this.invoke("notesInfo", { notes });
    if (!Array.isArray(result)) throw new Error("Invalid Anki note data.");
    const notesFound = result.filter(note => note !== null && !(note && typeof note === "object" && Object.keys(note).length === 0));
    if (notesFound.some(note => !note || !Number.isSafeInteger(note.noteId) ||
      typeof note.modelName !== "string" || !note.fields || !Array.isArray(note.tags) || !Array.isArray(note.cards) ||
      Object.values(note.fields).some(field => !field || typeof (field as { value?: unknown }).value !== "string"))) {
      throw new Error("Invalid Anki note data.");
    }
    return notesFound;
  }

  async cardsInfo(cards: number[]): Promise<RemoteCard[]> {
    if (!cards.length) return [];
    const result = await this.invoke("cardsInfo", { cards });
    if (!Array.isArray(result) || result.some(card => !card || !Number.isSafeInteger(card.cardId) ||
      !Number.isSafeInteger(card.note) || !Number.isInteger(card.queue) || !Number.isInteger(card.type))) throw new Error("Invalid Anki card data.");
    const models = [...new Set(result.map(card => card.modelName as string))];
    const templates = new Map(await Promise.all(models.map(async model => {
      const values = await this.invoke("modelTemplates", { modelName: model });
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid Anki card templates.");
      return [model, Object.keys(values)] as const;
    })));
    return result.map(card => ({ ...card, template: card.template || templates.get(card.modelName)?.[card.ord] || "" }));
  }

  async updateFields(id: number, fields: Record<string, string>): Promise<void> {
    await this.invoke("updateNoteFields", { note: { id, fields } });
  }
  async addTags(notes: number[], tags: string[]): Promise<void> {
    if (tags.length) await this.invoke("addTags", { notes, tags: tags.join(" ") });
  }
  async reviews(cardId: number): Promise<Array<{ id: number; ease: number; [key: string]: unknown }>> {
    const result = await this.invoke("getReviewsOfCards", { cards: [cardId] }) as Record<string, unknown>;
    const reviews = result?.[String(cardId)];
    if (!Array.isArray(reviews) || reviews.some(review => !Number.isSafeInteger(review.id))) throw new Error("Invalid Anki review history.");
    return reviews;
  }
  async answer(cardId: number, ease: number): Promise<void> {
    if (![1, 2, 3, 4].includes(ease)) throw new Error("Invalid review rating.");
    const result = await this.invoke("answerCards", { answers: [{ cardId, ease }] });
    if (!Array.isArray(result) || result.length !== 1 || result[0] !== true) throw new Error("Anki did not confirm this review.");
  }
  async retrieveMedia(filename: string): Promise<string | false> {
    const result = await this.invoke("retrieveMediaFile", { filename });
    if (result !== false && typeof result !== "string") throw new Error("Invalid Anki media response.");
    return result;
  }
  async storeMedia(filename: string, data: string): Promise<string> {
    const result = await this.invoke("storeMediaFile", { filename, data });
    if (typeof result !== "string" || !result) throw new Error("Anki did not confirm the media upload.");
    return result;
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
      throw new AnkiConnectError(`Anki rejected adding card "${note.fields.Word || note.fields.Front || ''}". It may already exist as a duplicate in deck "${note.deckName}".`, true);
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
    const exportSettings = await getSettings();
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
        case "sentence": return richText(data.sentence || "");
        case "sentenceFurigana": return furiganaHtml(data.sentenceFurigana || data.sentence || "");
        case "sentenceReading": return escapeHtml(data.sentenceReading || "");
        case "sentenceMeaning": return escapeHtml(data.sentenceMeaning || "");
        case "jlptLevel": return escapeHtml((exportSettings.ankiPreset === "japanese" ? normalizeJlpt(data.jlptLevel).slice(1) : data.jlptLevel) || "");
        case "notes": return richText(data.notes || "");
        case "pos": return escapeHtml(data.pos || "");
        case "imageUrl": return data.picture || (data.imageUrl ? `<img src="${escapeHtml(data.imageUrl)}" />` : "");
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
