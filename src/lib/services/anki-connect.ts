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

class AnkiConnectClient {
  private url: string;

  constructor(url: string = ANKI_CONNECT_URL) {
    this.url = url;
  }

  /** Send a request to AnkiConnect */
  private async invoke(
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const request: AnkiConnectRequest = {
      action,
      version: ANKI_CONNECT_VERSION,
      ...(params ? { params } : {}),
    };

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        body: JSON.stringify(request),
      });
    } catch (err: any) {
      throw new Error(`AnkiConnect connection failed: Cannot reach Anki at ${this.url}. Please make sure Anki app is open with the AnkiConnect add-on enabled.`);
    }

    if (!response.ok) {
      throw new Error(`AnkiConnect HTTP error (${response.status}): ${response.statusText}`);
    }

    let data: AnkiConnectResponse;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error("Invalid JSON response from AnkiConnect.");
    }

    if (data.error) {
      throw new Error(`AnkiConnect error: ${data.error}`);
    }

    return data.result;
  }

  /** Check if AnkiConnect is reachable */
  async isConnected(): Promise<boolean> {
    try {
      await this.invoke("version");
      return true;
    } catch {
      return false;
    }
  }

  /** Get AnkiConnect version */
  async getVersion(): Promise<number> {
    return (await this.invoke("version")) as number;
  }

  /** List all deck names */
  async getDecks(): Promise<string[]> {
    return (await this.invoke("deckNames")) as string[];
  }

  /** List all model (note type) names */
  async getModels(): Promise<string[]> {
    return (await this.invoke("modelNames")) as string[];
  }

  /** Get field names for a model */
  async getModelFields(modelName: string): Promise<string[]> {
    return (await this.invoke("modelFieldNames", {
      modelName,
    })) as string[];
  }

  /** Create a new deck if it doesn't exist */
  async createDeck(deckName: string): Promise<number> {
    return (await this.invoke("createDeck", { deck: deckName })) as number;
  }

  /** Add a note to Anki */
  async addNote(note: AnkiNote): Promise<number> {
    const result = await this.invoke("addNote", { note });
    if (result === null || result === undefined) {
      throw new Error(`Anki rejected adding card "${note.fields.Word || note.fields.Front || ''}". It may already exist as a duplicate in deck "${note.deckName}".`);
    }
    return result as number;
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
    const targetDeck = (deckName && deckName.trim()) || "Hakkutsu";
    const targetModel = (modelName && modelName.trim()) || "Basic";

    // Ensure target deck exists in Anki first
    try {
      await this.createDeck(targetDeck);
    } catch (e) {
      console.warn("[AnkiConnect] createDeck warning:", e);
    }

    const imgHtml = data.imageUrl
      ? `<div class="illustration" style="margin-top: 10px; text-align: center;"><img src="${data.imageUrl}" style="max-width: 280px; border-radius: 8px;" /></div>`
      : "";

    const frontHtml = `<div class="hakkutsu-card">
  <div class="word">${data.word}</div>
  <div class="reading">${data.reading}</div>
  ${data.jlptLevel ? `<div class="jlpt">${data.jlptLevel}</div>` : ""}
</div>`;

    const backHtml = `<div class="hakkutsu-card">
  <div class="meaning">${data.meaning}</div>
  <div class="pos">${data.pos}</div>
  ${data.sentence ? `<div class="sentence">${data.sentence}</div>` : ""}
  ${data.sentenceReading ? `<div class="sentence-reading">${data.sentenceReading}</div>` : ""}
  ${data.sourceUrl ? `<div class="source-link" style="margin-top: 8px; font-size: 11px;"><a href="${data.sourceUrl}" target="_blank">Video Context</a></div>` : ""}
  ${data.screenshot ? `<div class="screenshot" style="margin-top: 10px;"><img src="${data.screenshot}" style="max-width: 100%; border-radius: 8px;" /></div>` : ""}
  ${imgHtml}
</div>`;

    const getValueForChoice = (choice: string): string => {
      switch (choice) {
        case "word": return data.word;
        case "reading": return data.reading;
        case "wordFurigana": return data.wordFurigana || data.reading || data.word;
        case "meaning": return data.meaning;
        case "vietnameseSound": return data.vietnameseSound || "";
        case "sentence": return data.sentence || "";
        case "sentenceFurigana": return data.sentenceFurigana || data.sentence || "";
        case "sentenceReading": return data.sentenceReading || "";
        case "sentenceMeaning": return data.sentenceMeaning || "";
        case "jlptLevel": return data.jlptLevel || "";
        case "pos": return data.pos || "";
        case "imageUrl": return data.imageUrl ? `<img src="${data.imageUrl}" />` : "";
        case "screenshot": return data.screenshot ? `<img src="${data.screenshot}" />` : "";
        case "sourceUrl": return data.sourceUrl ? `<a href="${data.sourceUrl}" target="_blank">Video Context</a>` : "";
        case "audio": return data.audio || "";
        case "sentenceAudio": return data.sentenceAudio || "";
        case "frontHtml": return frontHtml;
        case "backHtml": return backHtml;
        case "none":
        default:
          return "";
      }
    };

    const fields: Record<string, string> = {};

    if (fieldMap && Object.keys(fieldMap).length > 0) {
      for (const [fieldName, choice] of Object.entries(fieldMap)) {
        if (choice && choice !== "none") {
          fields[fieldName] = getValueForChoice(choice);
        } else {
          fields[fieldName] = "";
        }
      }
    } else {
      // Default fallback mappings
      fields.Front = frontHtml;
      fields.Back = backHtml;
      fields.Word = data.word;
      fields.Reading = data.reading;
      fields.Meaning = data.meaning;
      fields.Sentence = data.sentence || "";
      if (data.imageUrl) {
        fields.Image = `<img src="${data.imageUrl}" />`;
        fields.Illustration = `<img src="${data.imageUrl}" />`;
      }
    }

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
