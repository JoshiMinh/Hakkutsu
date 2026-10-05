import { getDB } from "./local-lookup"

const STORE_NAME = "jmdict"

export async function initDictionaryDB() {
  return getDB()
}

export async function syncDictionary(sourceUrl?: string): Promise<number> {
  try {
    const db = await initDictionaryDB()
    
    // Check if we already have entries
    const count = await db.count(STORE_NAME)
    if (count > 0) {
      console.log(`[Hakkutsu] Dictionary already synced (${count} entries).`)
      return count
    }

    if (!sourceUrl) throw new Error("Provide a dictionary JSON source URL before downloading JMdict.")
    const url = new URL(sourceUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Dictionary source must be an HTTP or HTTPS URL.")
    console.log("[Hakkutsu] Downloading JMdict...")
    const response = await fetch(url.href)
    
    if (!response.ok) {
      throw new Error("Failed to fetch dictionary")
    }

    const dictData = await response.json()
    const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && item.trim())
    if (!Array.isArray(dictData) || dictData.length === 0) throw new Error("Dictionary JSON must contain a nonempty array of entries.")
    for (const [index, entry] of dictData.entries()) {
      if (!entry || (typeof entry.id !== "string" && !(Number.isSafeInteger(entry.id) && entry.id > 0)) ||
        !String(entry.id).trim() || !strings(entry.kanjiElements) || !strings(entry.readingElements) || !entry.readingElements.length ||
        !Array.isArray(entry.senses) || entry.senses.some((sense: any) => !sense || !strings(sense.partOfSpeech) || !strings(sense.glosses))) {
        throw new Error(`Dictionary entry ${index + 1} is invalid.`)
      }
    }
    
    console.log("[Hakkutsu] Populating IndexedDB...")
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)

    const completion = tx.done
    void completion.catch(() => {})
    try {
      // IndexedDB keys and deduplication use the same ID type for every source.
      for (const entry of dictData) await store.put({ ...entry, id: String(entry.id) })
      await completion
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await completion.catch(() => {})
      throw error
    }
    console.log("[Hakkutsu] Dictionary sync complete!")
    return await db.count(STORE_NAME)
  } catch (error) {
    console.error("[Hakkutsu] Dictionary sync failed:", error)
    throw error
  }
}
