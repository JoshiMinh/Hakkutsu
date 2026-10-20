import { getDB } from "./local-lookup"

const STORE_NAME = "jmdict"

/** Validate the complete file before touching the installed dictionary. */
export async function importDictionary(dictData: unknown): Promise<number> {
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && item.trim())
  if (!Array.isArray(dictData) || dictData.length === 0) throw new Error("Dictionary JSON must contain a nonempty array of entries.")
  for (const [index, entry] of dictData.entries()) {
    if (!entry || (typeof entry.id !== "string" && !(Number.isSafeInteger(entry.id) && entry.id > 0)) ||
      !String(entry.id).trim() || !strings(entry.kanjiElements) || !strings(entry.readingElements) || !entry.readingElements.length ||
      !Array.isArray(entry.senses) || entry.senses.some((sense: any) => !sense || !strings(sense.partOfSpeech) || !strings(sense.glosses))) {
      throw new Error(`Dictionary entry ${index + 1} is invalid.`)
    }
  }
  const db = await getDB()
  const tx = db.transaction(STORE_NAME, "readwrite")
  const completion = tx.done
  void completion.catch(() => {})
  try {
    for (const entry of dictData) await tx.store.put({ ...entry, id: String(entry.id) })
    await completion
  } catch (error) {
    try { tx.abort() } catch { /* Already aborted. */ }
    await completion.catch(() => {})
    throw error
  }
  return db.count(STORE_NAME)
}

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

    return await importDictionary(await response.json())
  } catch (error) {
    console.error("[Hakkutsu] Dictionary sync failed:", error)
    throw error
  }
}
