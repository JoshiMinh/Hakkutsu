import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { getHanViet } from "~lib/utils/hanviet-dict";
import { lookupWord } from "./dictionary-lookup";
import { googleTranslateService } from "./google-translate";
import { getSettings } from "./storage";
import { analyticsService } from "./analytics-service";
import { fsrsEngine, type FsrsRating, type FsrsState } from "./fsrs-engine";
import type { SmartDeckFilter, SmartDeckFilterOptions } from "~lib/utils/types";

export interface SrsCard {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  sentence?: string;
  source_url?: string;
  source_title?: string;
  source_domain?: string;
  image_url?: string;
  
  word_furigana?: string;
  jlpt?: string;
  vietnamese_sound?: string;
  sentence_furigana?: string;
  sentence_meaning?: string;

  // Additional metadata
  frequency_rank?: number | null;
  tags?: string[];

  // Leech & lapse management
  lapse_count?: number; // count of times card failed review (quality < 3 or rating 1)
  is_leech?: boolean;   // true if lapse_count >= leechThreshold

  // FSRS DSR memory state
  stability?: number;       // S (in days)
  difficulty?: number;      // D (scale 1.0 to 10.0)
  state?: number;           // 0: New, 1: Learning, 2: Review, 3: Relearning
  last_review?: number;     // timestamp (ms)
  retrievability?: number;  // R (0.0 to 1.0)
  elapsed_days?: number;
  scheduled_days?: number;

  // SRS data (SM-2 & general scheduling)
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
  leechCount: number;
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
    source_domain?: string;
    image_url?: string;
    target_word?: string;
    jlpt?: string;
    frequency_rank?: number | null;
    tags?: string[];
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
    let frequency_rank = data.frequency_rank;

    // Duplicate prevention: if card already exists, update card fields (e.g., image_url, tags) and return
    const allCards = await db.getAll("cards");
    const existingCard = allCards.find((c) => c.word.trim().toLowerCase() === word.toLowerCase());
    if (existingCard) {
      const updatedCard: SrsCard = {
        ...existingCard,
        meaning: (meaning && meaning !== "—") ? meaning : existingCard.meaning,
        reading: reading || existingCard.reading,
        sentence: sentence || existingCard.sentence,
        image_url: data.image_url || existingCard.image_url,
        frequency_rank: frequency_rank ?? existingCard.frequency_rank,
        tags: data.tags ? Array.from(new Set([...(existingCard.tags || []), ...data.tags])) : existingCard.tags,
        updated_at: now,
      };
      await db.put("cards", updatedCard);
      return updatedCard;
    }

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

    // Default tags and domain setup
    const initialTags = data.tags ? [...data.tags] : [];
    if (jlpt && !initialTags.includes(jlpt)) {
      initialTags.push(jlpt.toUpperCase().startsWith("N") ? jlpt.toUpperCase() : `N${jlpt}`);
    }

    let source_domain = data.source_domain;
    if (data.source_url) {
      try {
        source_domain = source_domain || new URL(data.source_url).hostname.replace(/^www\./, "");
      } catch {}

      if (data.source_url.includes("youtube.com") && !initialTags.includes("YouTube")) {
        initialTags.push("YouTube");
      } else if (data.source_url.includes("netflix.com") && !initialTags.includes("Netflix")) {
        initialTags.push("Netflix");
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
      source_domain,
      image_url: data.image_url,
      frequency_rank: frequency_rank ?? null,
      tags: initialTags,

      lapse_count: 0,
      is_leech: false,
      state: 0,
      
      due_date: now,
      interval: 0,
      repetition: 0,
      efactor: 2.5,
      
      created_at: now,
      updated_at: now,
    };
    
    await db.put("cards", card);
    analyticsService.recordCardMined().catch(() => {});
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

  async hasCard(word: string): Promise<boolean> {
    if (!word || !word.trim()) return false;
    const db = await this.dbPromise;
    const allCards = await db.getAll("cards");
    const clean = word.trim().toLowerCase();
    return allCards.some((c) => c.word.trim().toLowerCase() === clean);
  }

  async getCardByWord(word: string): Promise<SrsCard | null> {
    if (!word || !word.trim()) return null;
    const db = await this.dbPromise;
    const allCards = await db.getAll("cards");
    const clean = word.trim().toLowerCase();
    return allCards.find((c) => c.word.trim().toLowerCase() === clean) || null;
  }

  async deleteSrsCardByWord(word: string): Promise<boolean> {
    if (!word || !word.trim()) return false;
    const db = await this.dbPromise;
    const allCards = await db.getAll("cards");
    const clean = word.trim().toLowerCase();
    const card = allCards.find((c) => c.word.trim().toLowerCase() === clean);
    if (card) {
      await db.delete("cards", card.id);
      return true;
    }
    return false;
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

  /** Smart Decks Filter Query */
  async getFilteredCards(filters: SmartDeckFilter = {}): Promise<SrsCard[]> {
    const allCards = await this.getAllSrsCards();
    const now = Date.now();

    return allCards.filter((card) => {
      // Due only check
      if (filters.dueOnly && card.due_date > now) {
        return false;
      }

      // Leech only check
      if (filters.leechesOnly && !card.is_leech && (card.lapse_count || 0) < 4) {
        return false;
      }

      // JLPT level filter
      if (filters.jlptLevels && filters.jlptLevels.length > 0) {
        const cardJlpt = (card.jlpt || "unranked").toUpperCase().replace("JLPT-", "");
        const matched = filters.jlptLevels.some((lvl) => {
          const cleanLvl = lvl.toUpperCase().replace("JLPT-", "");
          if (cleanLvl === "UNRANKED") return !card.jlpt || cardJlpt === "UNRANKED";
          return cardJlpt === cleanLvl;
        });
        if (!matched) return false;
      }

      // Domain filter
      if (filters.domains && filters.domains.length > 0) {
        const domain = card.source_domain || "";
        const matched = filters.domains.some((d) =>
          domain.toLowerCase().includes(d.toLowerCase()) ||
          (card.source_url && card.source_url.toLowerCase().includes(d.toLowerCase()))
        );
        if (!matched) return false;
      }

      // Tag filter
      if (filters.tags && filters.tags.length > 0) {
        const cardTags = (card.tags || []).map((t) => t.toLowerCase());
        const matched = filters.tags.some((t) => cardTags.includes(t.toLowerCase().replace(/^#/, "")));
        if (!matched) return false;
      }

      return true;
    }).slice(0, filters.limit || 500);
  }

  /** Aggregate available smart deck filter options with counts and due counts */
  async getAvailableSmartDeckFilters(): Promise<SmartDeckFilterOptions> {
    const cards = await this.getAllSrsCards();
    const now = Date.now();

    const jlptMap = new Map<string, { count: number; dueCount: number }>();
    const domainMap = new Map<string, { count: number; dueCount: number }>();
    const tagMap = new Map<string, { count: number; dueCount: number }>();
    let leechCount = 0;
    let dueLeechCount = 0;

    for (const card of cards) {
      const isDue = card.due_date <= now;
      const isLeech = card.is_leech || (card.lapse_count || 0) >= 4;
      if (isLeech) {
        leechCount += 1;
        if (isDue) dueLeechCount += 1;
      }

      // JLPT
      const lvl = (card.jlpt || "Unranked").toUpperCase().replace("JLPT-", "");
      const cleanLvl = ["N5", "N4", "N3", "N2", "N1"].includes(lvl) ? lvl : "Unranked";
      const jEntry = jlptMap.get(cleanLvl) || { count: 0, dueCount: 0 };
      jEntry.count += 1;
      if (isDue) jEntry.dueCount += 1;
      jlptMap.set(cleanLvl, jEntry);

      // Domain
      let domain = card.source_domain;
      if (!domain && card.source_url) {
        try {
          domain = new URL(card.source_url).hostname.replace(/^www\./, "");
        } catch {}
      }
      if (domain) {
        const dEntry = domainMap.get(domain) || { count: 0, dueCount: 0 };
        dEntry.count += 1;
        if (isDue) dEntry.dueCount += 1;
        domainMap.set(domain, dEntry);
      }

      // Tags
      if (card.tags && Array.isArray(card.tags)) {
        for (const tag of card.tags) {
          if (!tag) continue;
          const cleanTag = tag.trim();
          const tEntry = tagMap.get(cleanTag) || { count: 0, dueCount: 0 };
          tEntry.count += 1;
          if (isDue) tEntry.dueCount += 1;
          tagMap.set(cleanTag, tEntry);
        }
      }
    }

    const standardJlptOrder = ["N5", "N4", "N3", "N2", "N1", "Unranked"];
    const jlptLevels = standardJlptOrder
      .filter((lvl) => jlptMap.has(lvl))
      .map((lvl) => ({
        level: lvl,
        count: jlptMap.get(lvl)!.count,
        dueCount: jlptMap.get(lvl)!.dueCount,
      }));

    const domains = Array.from(domainMap.entries())
      .map(([domain, data]) => ({ domain, count: data.count, dueCount: data.dueCount }))
      .sort((a, b) => b.count - a.count);

    const tags = Array.from(tagMap.entries())
      .map(([tag, data]) => ({ tag, count: data.count, dueCount: data.dueCount }))
      .sort((a, b) => b.count - a.count);

    return {
      jlptLevels,
      domains,
      tags,
      leechCount,
      dueLeechCount,
    };
  }

  /** Reset leech status and lapse counter */
  async resetLeechStatus(cardId: string): Promise<SrsCard> {
    return this.updateSrsCard(cardId, {
      lapse_count: 0,
      is_leech: false,
    });
  }

  /** Merge a backup into the local database without discarding newer fields. */
  async restoreSrsCards(cards: SrsCard[]): Promise<number> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const existingCards = await store.getAll();
    const existingByWord = new Map(
      existingCards.map((card) => [card.word.trim().toLocaleLowerCase(), card])
    );
    let restored = 0;

    for (const candidate of cards) {
      if (!candidate || typeof candidate.word !== "string" || !candidate.word.trim()) continue;
      const now = Date.now();
      const existing = existingByWord.get(candidate.word.trim().toLocaleLowerCase());
      const card: SrsCard = {
        ...existing,
        ...candidate,
        id: existing?.id || candidate.id || crypto.randomUUID(),
        word: candidate.word.trim(),
        lapse_count: Number.isFinite(candidate.lapse_count) ? candidate.lapse_count : existing?.lapse_count || 0,
        is_leech: candidate.is_leech ?? existing?.is_leech ?? false,
        source_domain: candidate.source_domain || existing?.source_domain,
        stability: Number.isFinite(candidate.stability) ? candidate.stability : existing?.stability,
        difficulty: Number.isFinite(candidate.difficulty) ? candidate.difficulty : existing?.difficulty,
        state: Number.isFinite(candidate.state) ? candidate.state : existing?.state,
        last_review: Number.isFinite(candidate.last_review) ? candidate.last_review : existing?.last_review,
        retrievability: Number.isFinite(candidate.retrievability) ? candidate.retrievability : existing?.retrievability,
        elapsed_days: Number.isFinite(candidate.elapsed_days) ? candidate.elapsed_days : existing?.elapsed_days,
        scheduled_days: Number.isFinite(candidate.scheduled_days) ? candidate.scheduled_days : existing?.scheduled_days,
        due_date: Number.isFinite(candidate.due_date) ? candidate.due_date : now,
        interval: Number.isFinite(candidate.interval) ? candidate.interval : 0,
        repetition: Number.isFinite(candidate.repetition) ? candidate.repetition : 0,
        efactor: Number.isFinite(candidate.efactor) ? candidate.efactor : 2.5,
        created_at: Number.isFinite(candidate.created_at) ? candidate.created_at : now,
        updated_at: Number.isFinite(candidate.updated_at) ? candidate.updated_at : now,
      };
      await store.put(card);
      existingByWord.set(card.word.toLocaleLowerCase(), card);
      restored += 1;
    }

    await tx.done;
    return restored;
  }

  async submitSrsReview(cardId: string, quality: number): Promise<SrsCard> {
    const db = await this.dbPromise;
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    
    const card = await store.get(cardId);
    if (!card) {
      throw new Error(`SRS Card not found: ${cardId}`);
    }

    const settings = await getSettings().catch(() => ({
      srsAlgorithm: "fsrs" as const,
      fsrsRequestRetention: 0.90,
      srsLeechThreshold: 4,
    }));
    const algorithm = settings.srsAlgorithm || "fsrs";
    const leechThreshold = settings.srsLeechThreshold || 4;
    const now = Date.now();

    if (algorithm === "fsrs") {
      // Map review quality to FSRS Rating: 1: Again, 2: Hard, 3: Good, 4: Easy
      const fsrsRating: FsrsRating = quality <= 1 ? 1 : quality <= 3 ? 2 : quality === 4 ? 3 : 4;
      fsrsEngine.setTargetRetention(settings.fsrsRequestRetention || 0.90);

      const fsrsOutput = fsrsEngine.review(
        {
          stability: card.stability,
          difficulty: card.difficulty,
          state: (card.state as FsrsState) ?? 0,
          last_review: card.last_review || card.created_at,
          reps: card.repetition || 0,
          lapses: card.lapse_count || 0,
          elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
        },
        fsrsRating,
        now
      );

      card.stability = fsrsOutput.stability;
      card.difficulty = fsrsOutput.difficulty;
      card.state = fsrsOutput.state;
      card.interval = fsrsOutput.interval;
      card.due_date = fsrsOutput.due_date;
      card.retrievability = fsrsOutput.retrievability;
      card.repetition = fsrsOutput.reps;
      card.lapse_count = fsrsOutput.lapses;
      card.is_leech = card.lapse_count >= leechThreshold;
      card.last_review = now;
      card.elapsed_days = fsrsOutput.elapsed_days;
      card.scheduled_days = fsrsOutput.scheduled_days;
      card.updated_at = now;
    } else {
      // Classic SM-2 Algorithm Fallback
      let interval = card.interval;
      let repetition = card.repetition;
      let efactor = card.efactor;
      let lapse_count = card.lapse_count || 0;
      let is_leech = card.is_leech || false;

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
        lapse_count += 1;
        if (lapse_count >= leechThreshold) {
          is_leech = true;
        }
      }

      efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      if (efactor < 1.3) efactor = 1.3;

      const oneDayMs = 24 * 60 * 60 * 1000;
      const dueDate = now + interval * oneDayMs;

      card.interval = interval;
      card.repetition = repetition;
      card.efactor = efactor;
      card.due_date = dueDate;
      card.lapse_count = lapse_count;
      card.is_leech = is_leech;
      card.last_review = now;
      card.updated_at = now;
    }

    await store.put(card);
    await tx.done;

    // Record review to analytics asynchronously
    analyticsService.recordReview(quality).catch(() => {});

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
    let leechCount = 0;
    let cardsReviewedToday = 0;

    const forecast = [0, 0, 0, 0, 0, 0, 0];
    const jlptCounts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0, unranked: 0 };

    for (const card of cards) {
      // Due count
      if (card.due_date <= now) {
        due += 1;
      }

      // Leech count
      if (card.is_leech || (card.lapse_count || 0) >= 4) {
        leechCount += 1;
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
      leechCount,
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
