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

    const response = await fetch(this.url, {
      method: "POST",
      body: JSON.stringify(request),
    });

    const data: AnkiConnectResponse = await response.json();

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
    return (await this.invoke("addNote", { note })) as number;
  }

  /**
   * Export a vocabulary entry to Anki using Hakkutsu's card format.
   *
   * Creates a note with: word, reading, meaning, sentence, JLPT level.
   */
  async exportVocabulary(
    data: AnkiExportData,
    deckName: string = "Hakkutsu",
    modelName: string = "Basic"
  ): Promise<number> {
    const imgHtml = data.imageUrl
      ? `<div class="illustration" style="margin-top: 10px; text-align: center;"><img src="${data.imageUrl}" style="max-width: 280px; border-radius: 8px;" /></div>`
      : "";

    // Build the front/back fields
    const front = `<div class="hakkutsu-card">
  <div class="word">${data.word}</div>
  <div class="reading">${data.reading}</div>
  ${data.jlptLevel ? `<div class="jlpt">${data.jlptLevel}</div>` : ""}
</div>`;

    const back = `<div class="hakkutsu-card">
  <div class="meaning">${data.meaning}</div>
  <div class="pos">${data.pos}</div>
  ${data.sentence ? `<div class="sentence">${data.sentence}</div>` : ""}
  ${data.sentenceReading ? `<div class="sentence-reading">${data.sentenceReading}</div>` : ""}
  ${data.sourceUrl ? `<div class="source-link" style="margin-top: 8px; font-size: 11px;"><a href="${data.sourceUrl}" target="_blank">Video Context</a></div>` : ""}
  ${data.screenshot ? `<div class="screenshot" style="margin-top: 10px;"><img src="${data.screenshot}" style="max-width: 100%; border-radius: 8px;" /></div>` : ""}
  ${imgHtml}
</div>`;

    const fields: Record<string, string> = {
      Front: front,
      Back: back,
      Word: data.word,
      Reading: data.reading,
      Meaning: data.meaning,
      Sentence: data.sentence || "",
    };

    if (data.imageUrl) {
      fields["Image"] = `<img src="${data.imageUrl}" />`;
      fields["Illustration"] = `<img src="${data.imageUrl}" />`;
    }

    const note: AnkiNote = {
      deckName,
      modelName,
      fields,
      options: { allowDuplicate: false },
      tags: ["hakkutsu", data.jlptLevel || "unranked"].filter(Boolean),
    };

    return this.addNote(note);
  }
}

/** Singleton instance */
export const ankiClient = new AnkiConnectClient();
