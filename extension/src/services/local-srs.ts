import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface SrsCard {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  sentence?: string;
  source_url?: string;
  source_title?: string;
  
  // SRS data
  due_date: number; // timestamp
  interval: number; // days
  repetition: number;
  efactor: number;
  
  created_at: number;
  updated_at: number;
}

export interface SrsStats {
  due: number;
  new: number;
  learning: number;
  graduated: number;
}

interface SrsDBSchema extends DBSchema {
  cards: {
    key: string;
    value: SrsCard;
    indexes: {
      "by-due-date": number;
      "by-created-at": number;
    };
  };
}

class LocalSrsService {
  private dbName = "hakkutsu-srs";
  private dbPromise: Promise<IDBPDatabase<SrsDBSchema>>;

  constructor() {
    this.dbPromise = openDB<SrsDBSchema>(this.dbName, 1, {
      upgrade(db) {
        const store = db.createObjectStore("cards", { keyPath: "id" });
        store.createIndex("by-due-date", "due_date");
        store.createIndex("by-created-at", "created_at");
      },
    });
  }

  async addSrsCard(data: {
    word: string;
    reading?: string;
    meaning?: string;
    sentence?: string;
    source_url?: string;
    source_title?: string;
    target_word?: string;
  }): Promise<SrsCard> {
    const db = await this.dbPromise;
    const now = Date.now();
    const word = data.target_word || data.word;
    
    const card: SrsCard = {
      id: crypto.randomUUID(),
      word,
      reading: data.reading,
      meaning: data.meaning,
      sentence: data.sentence,
      source_url: data.source_url,
      source_title: data.source_title,
      
      due_date: now,
      interval: 0,
      repetition: 0,
      efactor: 2.5,
      
      created_at: now,
      updated_at: now,
    };
    
    await db.put("cards", card);
    return card;
  }

  async mineSentence(data: {
    sentence: string;
    source_url?: string;
    source_title?: string;
    target_word?: string;
  }): Promise<SrsCard> {
    return this.addSrsCard({
      word: data.target_word || "Unknown",
      sentence: data.sentence,
      source_url: data.source_url,
      source_title: data.source_title,
      target_word: data.target_word,
    });
  }

  async getDueCards(limit: number = 50): Promise<SrsCard[]> {
    const db = await this.dbPromise;
    const now = Date.now();
    
    const range = IDBKeyRange.upperBound(now);
    const tx = db.transaction("cards", "readonly");
    const index = tx.store.index("by-due-date");
    
    let cursor = await index.openCursor(range);
    const results: SrsCard[] = [];
    
    while (cursor && results.length < limit) {
      results.push(cursor.value);
      cursor = await cursor.continue();
    }
    
    return results;
  }

  async getAllSrsCards(): Promise<SrsCard[]> {
    const db = await this.dbPromise;
    return db.getAll("cards");
  }

  async getSrsStats(): Promise<SrsStats> {
    const db = await this.dbPromise;
    const allCards = await db.getAll("cards");
    const now = Date.now();
    
    let due = 0;
    let newCards = 0;
    let learning = 0;
    let graduated = 0;
    
    for (const card of allCards) {
      if (card.due_date <= now) {
        due++;
      }
      
      if (card.repetition === 0) {
        newCards++;
      } else if (card.interval < 21) {
        learning++;
      } else {
        graduated++;
      }
    }
    
    return { due, new: newCards, learning, graduated };
  }

  async submitSrsReview(cardId: string, quality: number): Promise<SrsCard> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    const card = await tx.store.get(cardId);
    
    if (!card) {
      throw new Error(`Card with ID ${cardId} not found`);
    }
    
    // SuperMemo-2 Algorithm
    // Quality: 0-5 (0 = complete blackout, 5 = perfect response)
    
    let { interval, repetition, efactor } = card;
    
    if (quality >= 3) {
      if (repetition === 0) {
        interval = 1;
      } else if (repetition === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * efactor);
      }
      repetition++;
    } else {
      repetition = 0;
      interval = 1;
    }
    
    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;
    
    const now = Date.now();
    const newDueDate = now + interval * 24 * 60 * 60 * 1000;
    
    card.interval = interval;
    card.repetition = repetition;
    card.efactor = efactor;
    card.due_date = newDueDate;
    card.updated_at = now;
    
    await tx.store.put(card);
    await tx.done;
    
    return card;
  }
}

export const localSrs = new LocalSrsService();
