import * as kuromoji from "kuromoji"
import Kuroshiro from "kuroshiro"
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji"

let kuroshiroInstance: Kuroshiro | null = null
let tokenizerInstance: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null
let initializationPromise: Promise<void> | null = null

// Note: Kuromoji requires dictionary files to be served via URL. 
// In an extension, these need to be placed in an accessible folder (e.g. extension/assets/dict)
// For this setup, we'll assume they are available at a CDN or local relative path.
const DICT_PATH = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict"

export async function initNLP(): Promise<void> {
  if (kuroshiroInstance && tokenizerInstance) return

  if (!initializationPromise) {
    initializationPromise = new Promise((resolve, reject) => {
      console.log("[Hakkutsu] Initializing NLP (Kuromoji & Kuroshiro)...")
      
      const kuroshiro = new Kuroshiro()
      
      kuroshiro.init(new KuromojiAnalyzer({ dictPath: DICT_PATH }))
        .then(() => {
          kuroshiroInstance = kuroshiro
          
          kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
            if (err) {
              console.error("[Hakkutsu] Kuromoji build failed", err)
              reject(err)
              return
            }
            tokenizerInstance = tokenizer
            console.log("[Hakkutsu] NLP initialized successfully.")
            resolve()
          })
        })
        .catch((err) => {
          console.error("[Hakkutsu] Kuroshiro init failed", err)
          reject(err)
        })
    })
  }

  return initializationPromise
}

export interface Token {
  surface_form: string
  pos: string
  reading?: string
  base_form: string
}

export async function tokenize(text: string): Promise<Token[]> {
  await initNLP()
  if (!tokenizerInstance) throw new Error("Tokenizer not initialized")

  const tokens = tokenizerInstance.tokenize(text)
  
  return tokens.map(t => ({
    surface_form: t.surface_form,
    pos: t.pos,
    reading: t.reading,
    base_form: t.basic_form === "*" ? t.surface_form : t.basic_form
  }))
}

export async function getFurigana(text: string): Promise<string> {
  await initNLP()
  if (!kuroshiroInstance) throw new Error("Kuroshiro not initialized")

  // Convert to HTML ruby tags or hiragana
  return await kuroshiroInstance.convert(text, {
    mode: "furigana",
    to: "hiragana"
  })
}
