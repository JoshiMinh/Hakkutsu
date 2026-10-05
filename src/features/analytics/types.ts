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
  totalJapaneseChars: number;
  totalKanji: number;
  uniqueKanji: number;
  jlptDistribution: {
    N5: number;
    N4: number;
    N3: number;
    N2: number;
    N1: number;
    unranked: number;
  };
  percentages: {
    N5: number;
    N4: number;
    N3: number;
    N2: number;
    N1: number;
    unranked: number;
  };
  dominantLevel: string;
  unlearnedCount: number;
  immersionScore: number;
}
