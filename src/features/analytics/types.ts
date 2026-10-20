export interface DailyActivity {
  date: string; // "YYYY-MM-DD"
  charactersRead: number;
  videoImmersionSeconds: number;
  miningVolume: number;
  reviewsCount: number;
  passedReviewsCount: number;
  retentionRate: number;
}

export interface OverallAnalyticsSummary {
  totalCharactersRead: number;
  totalVideoImmersionSeconds: number;
  totalCardsMined: number;
  totalReviewsCompleted: number;
  averageRetentionRate: number;
  currentStreakDays: number;
  longestStreakDays: number;
  todayCharactersRead: number;
  todayVideoImmersionSeconds: number;
  todayCardsMined: number;
  todayReviewsCount: number;
  todayRetentionRate: number;
  recentDailyActivities: DailyActivity[];
}




export interface PageDensityAnalysis {
  url: string;
  scope: "article" | "page" | "selection";
  totalTextChars: number;
  totalJapaneseChars: number;
  scriptDensity: number;
  totalKanji: number;
  uniqueKanji: number;
  vocabularyStatus: "available" | "unavailable";
  totalWords: number;
  uniqueWords: number;
  coverage: number;
  jlptDistribution: LevelCounts;
  percentages: LevelCounts;
  dominantLevel: JlptLevel | null;
  familiarity: { status: "available" | "unavailable"; mature: number; learning: number; notSaved: number };
}

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type LevelCounts = Record<JlptLevel | "unranked", number>;
export interface DensityWord { lemma: string; level: JlptLevel | null; count: number }
