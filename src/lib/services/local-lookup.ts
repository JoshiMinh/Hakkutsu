import { openDB } from "idb"
import type { IDBPDatabase } from "idb"

const DB_NAME = "HakkutsuDictDB"
const STORE_NAME = "jmdict"

let dbInstance: IDBPDatabase | null = null
let opening: Promise<IDBPDatabase> | null = null

export async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance
  if (!opening) {
    // Version 1 could be created by lookup without any stores. Upgrade both
    // fresh installations and those empty databases using the same schema.
    opening = Promise.resolve().then(() => openDB(DB_NAME, 2, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? transaction.objectStore(STORE_NAME) : db.createObjectStore(STORE_NAME, { keyPath: "id" })
        if (!store.indexNames.contains("kanji")) store.createIndex("kanji", "kanjiElements", { multiEntry: true })
        if (!store.indexNames.contains("reading")) store.createIndex("reading", "readingElements", { multiEntry: true })
      },
      blocking() { dbInstance?.close(); dbInstance = null; opening = null },
      terminated() { dbInstance = null; opening = null },
    })).then(db => { dbInstance = db; return db }).catch(error => { opening = null; throw error })
  }
  return opening
}

export interface DictEntry {
  id: string
  kanjiElements: string[]
  readingElements: string[]
  senses: {
    partOfSpeech: string[]
    glosses: string[]
  }[]
  jlpt?: string
}

export async function searchDictionary(query: string): Promise<DictEntry[]> {
  try {
    const db = await getDB()
    const results: DictEntry[] = []

    // Try kanji match first
    const tx = db.transaction(STORE_NAME, "readonly")
    const completion = tx.done
    void completion.catch(() => {})
    const store = tx.objectStore(STORE_NAME)
    
    // Using IDBKeyRange to match keys exactly
    // In a real robust local dictionary, you'd implement prefix searches or full-text,
    // but this serves as the basic direct match.
    const kanjiIndex = store.index("kanji")
    const readingIndex = store.index("reading")

    const byKanji = await kanjiIndex.getAll(query)
    const byReading = await readingIndex.getAll(query)
    await completion

    // Deduplicate results
    const seen = new Set<string>()
    for (const entry of [...byKanji, ...byReading]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id)
        results.push(entry)
      }
    }

    return results
  } catch (error) {
    console.error("[Hakkutsu] Dictionary search failed:", error)
    return []
  }
}
