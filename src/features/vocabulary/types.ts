export interface VocabularyEntry {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  jlptLevel: string | null;
  context: string;
  sourceUrl: string;
  addedAt: number;
  exported: boolean;
  imageUrl?: string;
}
