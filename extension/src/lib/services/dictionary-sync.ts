import { openDB } from "idb"

// A sample CDN URL. In a real scenario, this would point to your hosted JMdict JSON
const JMDICT_CDN_URL = "https://hakkutsu-assets.example.com/jmdict-optimized.json"
const DB_NAME = "HakkutsuDictDB"
const STORE_NAME = "jmdict"

export async function initDictionaryDB() {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        // Create indexes for fast lookup by kanji or reading
        store.createIndex("kanji", "kanjiElements", { multiEntry: true })
        store.createIndex("reading", "readingElements", { multiEntry: true })
      }
    }
  })
  return db
}

export async function syncDictionary() {
  try {
    const db = await initDictionaryDB()
    
    // Check if we already have entries
    const count = await db.count(STORE_NAME)
    if (count > 0) {
      console.log(`[Hakkutsu] Dictionary already synced (${count} entries).`)
      return
    }

    console.log("[Hakkutsu] Downloading JMdict...")
    // Simulate fetching the dictionary. In reality, you'd stream and chunk this 
    // due to size, or download a highly compressed version.
    const response = await fetch(JMDICT_CDN_URL)
    
    if (!response.ok) {
      throw new Error("Failed to fetch dictionary")
    }

    const dictData = await response.json()
    
    console.log("[Hakkutsu] Populating IndexedDB...")
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)

    // Insert entries
    for (const entry of dictData) {
      await store.put(entry)
    }

    await tx.done
    console.log("[Hakkutsu] Dictionary sync complete!")
  } catch (error) {
    console.error("[Hakkutsu] Dictionary sync failed:", error)
  }
}

// In Manifest V3, service workers run event listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Hakkutsu] Extension installed/updated. Syncing dictionary...")
  // We can't block the install event, so run async
  syncDictionary().catch(console.error)
})
