import { openDB } from "idb"
import type { IDBPDatabase } from "idb"

const DB_NAME = "HakkutsuDictDB"
const STORE_NAME = "jmdict"

let dbInstance: IDBPDatabase | null = null

export async function getDB(): Promise<IDBPDatabase> {
  if (!dbInstance) {
    dbInstance = await openDB(DB_NAME, 1)
  }
  return dbInstance
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
    const store = tx.objectStore(STORE_NAME)
    
    // Using IDBKeyRange to match keys exactly
    // In a real robust local dictionary, you'd implement prefix searches or full-text,
    // but this serves as the basic direct match.
    const kanjiIndex = store.index("kanji")
    const readingIndex = store.index("reading")

    const byKanji = await kanjiIndex.getAll(query)
    const byReading = await readingIndex.getAll(query)

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
