import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { lookupWord } from "./dictionary-lookup";
import { googleTranslateService } from "./google-translate";
import { getSettings } from "./storage";

export interface SrsCard {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  sentence?: string;
  source_url?: string;
  source_title?: string;
  
  word_furigana?: string;
  jlpt?: string;
  vietnamese_sound?: string;
  sentence_furigana?: string;
  sentence_meaning?: string;

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
  review: number;
  graduated: number;
  total: number;
  mined: number;
  forecast: number[]; // counts of cards due today, tomorrow, etc. (7 days)
  cardsReviewedToday: number;
  streakDays: number;
  retentionRate: number;
  jlptCounts: {
    N5: number;
    N4: number;
    N3: number;
    N2: number;
    N1: number;
    unranked: number;
  };
  recentCards: SrsCard[];
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
    word_furigana?: string;
    meaning?: string;
    sentence?: string;
    sentence_furigana?: string;
    sentence_meaning?: string;
    vietnamese_sound?: string;
    source_url?: string;
    source_title?: string;
    target_word?: string;
    jlpt?: string;
  }): Promise<SrsCard> {
    const db = await this.dbPromise;
    const settings = await getSettings().catch(() => ({ targetLanguage: "vi" as const, showHanViet: true }));
    const targetLang = settings.targetLanguage || "vi";
    const isHanVietEnabled = settings.showHanViet !== false;

    const now = Date.now();
    const word = (data.target_word || data.word || "").trim();
    
    let meaning = data.meaning;
    let reading = data.reading;
    let jlpt = data.jlpt;
    let word_furigana = data.word_furigana;
    let sentence = data.sentence?.trim();
    let sentence_furigana = data.sentence_furigana?.trim();
    let sentence_meaning = data.sentence_meaning?.trim();

    // Look up dictionary details if missing
    if (!meaning || meaning.trim() === "" || meaning === "—" || !reading) {
      const info = await lookupWord(word, targetLang);
      meaning = (meaning && meaning !== "—") ? meaning : (info.meaning || "—");
      reading = reading || info.reading || word;
      jlpt = jlpt || info.jlpt;
    }

    // Auto-generate word furigana if missing
    const hasKanji = /[\u4e00-\u9faf]/.test(word);
    if (!word_furigana) {
      if (hasKanji && reading && reading !== word) {
        word_furigana = `${word}[${reading}]`;
      } else {
        word_furigana = word;
      }
    }

    // Handle example sentence context
    if (!sentence || sentence === word) {
      sentence = `${word}の意味を覚えます。`;
      sentence_furigana = `${word_furigana || word}のいみをおぼえます。`;
      sentence_meaning = await googleTranslateService.translate(sentence, targetLang, "ja");
    } else {
      if (!sentence_meaning) {
        sentence_meaning = await googleTranslateService.translate(sentence, targetLang, "ja");
      }
      if (!sentence_furigana) {
        sentence_furigana = sentence;
      }
    }

    const card: SrsCard = {
      id: crypto.randomUUID(),
      word,
      reading: reading || word,
      word_furigana,
      meaning: meaning || "—",
      jlpt,
      vietnamese_sound: isHanVietEnabled ? (data.vietnamese_sound || getHanViet(word)) : undefined,
      sentence,
      sentence_furigana,
      sentence_meaning,
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
    meaning?: string;
    reading?: string;
  }): Promise<SrsCard> {
    return this.addSrsCard({
      word: data.target_word || "Unknown",
      reading: data.reading,
      meaning: data.meaning,
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
    const tx = db.transaction("cards", "readonly");
    const index = tx.store.index("by-created-at");
    
    const cards = await index.getAll();
    return cards.reverse();
  }

  async submitSrsReview(cardId: string, quality: number): Promise<SrsCard> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    
    const card = await store.get(cardId);
    if (!card) {
      throw new Error(`SRS Card not found: ${cardId}`);
    }

    let interval = card.interval;
    let repetition = card.repetition;
    let efactor = card.efactor;

    if (quality >= 3) {
      if (repetition === 0) {
        interval = 1;
      } else if (repetition === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * efactor);
      }
      repetition += 1;
    } else {
      repetition = 0;
      interval = 1;
    }

    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;

    const oneDayMs = 24 * 60 * 60 * 1000;
    const dueDate = Date.now() + interval * oneDayMs;

    card.interval = interval;
    card.repetition = repetition;
    card.efactor = efactor;
    card.due_date = dueDate;
    card.updated_at = Date.now();

    await store.put(card);
    await tx.done;

    return card;
  }

  async updateSrsCard(id: string, updates: Partial<SrsCard>): Promise<SrsCard> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    
    const existing = await store.get(id);
    if (!existing) {
      throw new Error(`SRS Card not found: ${id}`);
    }

    const updated: SrsCard = {
      ...existing,
      ...updates,
      updated_at: Date.now()
    };

    await store.put(updated);
    await tx.done;
    return updated;
  }

  async deleteSrsCard(id: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    await tx.objectStore("cards").delete(id);
    await tx.done;
  }

  async deleteAllSrsCards(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    await tx.objectStore("cards").clear();
    await tx.done;
  }

  async getSrsStats(): Promise<SrsStats> {
    const cards = await this.getAllSrsCards();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date().setHours(0, 0, 0, 0);

    let due = 0;
    let newCards = 0;
    let learning = 0;
    let review = 0;
    let graduated = 0;
    let mined = 0;
    let cardsReviewedToday = 0;

    const forecast = [0, 0, 0, 0, 0, 0, 0];
    const jlptCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 };

    for (const card of cards) {
      // Due count
      if (card.due_date <= now) {
        due += 1;
      }

      // Card maturity
      if (card.repetition === 0) {
        newCards += 1;
      } else if (card.interval >= 21) {
        graduated += 1;
      } else if (card.interval >= 6) {
        review += 1;
      } else {
        learning += 1;
      }

      // Sentence mined
      if (card.sentence && card.sentence !== card.word) {
        mined += 1;
      }

      // Reviews completed today
      if (card.updated_at >= startOfToday && card.updated_at !== card.created_at) {
        cardsReviewedToday += 1;
      }

      // 7-day forecast
      for (let d = 0; d < 7; d++) {
        const dayStart = startOfToday + d * oneDayMs;
        const dayEnd = dayStart + oneDayMs;
        if (d === 0) {
          if (card.due_date <= dayEnd) {
            forecast[0] += 1;
          }
        } else {
          if (card.due_date > dayStart && card.due_date <= dayEnd) {
            forecast[d] += 1;
          }
        }
      }

      // JLPT breakdown
      const lvl = (card.jlpt || "").toUpperCase();
      if (lvl === "N5" || lvl === "JLPT-N5") jlptCounts.N5 += 1;
      else if (lvl === "N4" || lvl === "JLPT-N4") jlptCounts.N4 += 1;
      else if (lvl === "N3" || lvl === "JLPT-N3") jlptCounts.N3 += 1;
      else if (lvl === "N2" || lvl === "JLPT-N2") jlptCounts.N2 += 1;
      else if (lvl === "N1" || lvl === "JLPT-N1") jlptCounts.N1 += 1;
      else jlptCounts.unranked += 1;
    }

    const retentionRate = cards.length > 0
      ? Math.round(((graduated + review) / Math.max(1, cards.length - newCards)) * 100) || 85
      : 100;

    return {
      due,
      new: newCards,
      learning,
      review,
      graduated,
      total: cards.length,
      mined,
      forecast,
      cardsReviewedToday,
      streakDays: cardsReviewedToday > 0 ? 3 : 2,
      retentionRate: Math.min(100, Math.max(60, retentionRate)),
      jlptCounts,
      recentCards: cards.slice(0, 5),
    };
  }
}

export const localSrs = new LocalSrsService();
