import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { DailyActivity, OverallAnalyticsSummary } from "~lib/utils/types";

interface AnalyticsDBSchema extends DBSchema {
  daily_activity: {
    key: string; // "YYYY-MM-DD"
    value: DailyActivity;
    indexes: {
      "by-date": string;
    };
  };
}

export function formatLocalDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class AnalyticsService {
  private dbName = "hakkutsu-analytics";
  private dbPromise: Promise<IDBPDatabase<AnalyticsDBSchema>>;

  constructor() {
    this.dbPromise = openDB<AnalyticsDBSchema>(this.dbName, 1, {
      upgrade(db) {
        const store = db.createObjectStore("daily_activity", { keyPath: "date" });
        store.createIndex("by-date", "date");
      },
    });
  }

  private async getOrCreateTodayRecord(
    txStore?: any,
    targetDate: string = formatLocalDateKey()
  ): Promise<DailyActivity> {
    if (txStore) {
      const existing = await txStore.get(targetDate);
      if (existing) return existing;
      return {
        date: targetDate,
        charactersRead: 0,
        videoImmersionSeconds: 0,
        miningVolume: 0,
        reviewsCount: 0,
        passedReviewsCount: 0,
        retentionRate: 100,
      };
    }

    const db = await this.dbPromise;
    const existing = await db.get("daily_activity", targetDate);
    if (existing) return existing;
    return {
      date: targetDate,
      charactersRead: 0,
      videoImmersionSeconds: 0,
      miningVolume: 0,
      reviewsCount: 0,
      passedReviewsCount: 0,
      retentionRate: 100,
    };
  }

  /** Record Japanese characters read/encountered */
  async recordCharactersRead(count: number): Promise<void> {
    if (!Number.isFinite(count) || count <= 0) return;
    const db = await this.dbPromise;
    const tx = db.transaction("daily_activity", "readwrite");
    const store = tx.objectStore("daily_activity");
    const today = formatLocalDateKey();

    const record = await this.getOrCreateTodayRecord(store, today);
    record.charactersRead += count;
    await store.put(record);
    await tx.done;
  }

  /** Record video immersion playback time (in seconds) */
  async recordVideoImmersion(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const db = await this.dbPromise;
    const tx = db.transaction("daily_activity", "readwrite");
    const store = tx.objectStore("daily_activity");
    const today = formatLocalDateKey();

    const record = await this.getOrCreateTodayRecord(store, today);
    record.videoImmersionSeconds += Math.round(seconds);
    await store.put(record);
    await tx.done;
  }

  /** Record a sentence/word mined to SRS */
  async recordCardMined(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction("daily_activity", "readwrite");
    const store = tx.objectStore("daily_activity");
    const today = formatLocalDateKey();

    const record = await this.getOrCreateTodayRecord(store, today);
    record.miningVolume += 1;
    await store.put(record);
    await tx.done;
  }

  /** Record an SRS review result */
  async recordReview(quality: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction("daily_activity", "readwrite");
    const store = tx.objectStore("daily_activity");
    const today = formatLocalDateKey();

    const record = await this.getOrCreateTodayRecord(store, today);
    record.reviewsCount += 1;
    if (quality >= 3) {
      record.passedReviewsCount += 1;
    }
    record.retentionRate =
      record.reviewsCount > 0
        ? Math.round((record.passedReviewsCount / record.reviewsCount) * 100)
        : 100;

    await store.put(record);
    await tx.done;
  }

  /** Retrieve activity for a specific date */
  async getDailyActivity(date: string): Promise<DailyActivity | null> {
    const db = await this.dbPromise;
    return (await db.get("daily_activity", date)) || null;
  }

  /** Retrieve continuous activity list for the past N days (e.g. 365 or 120) */
  async getActivityHeatmap(days: number = 365): Promise<DailyActivity[]> {
    const db = await this.dbPromise;
    const allActivities = await db.getAll("daily_activity");
    const activityMap = new Map<string, DailyActivity>();
    for (const act of allActivities) {
      activityMap.set(act.date, act);
    }

    const results: DailyActivity[] = [];
    const now = new Date();
    // Normalize to midnight
    now.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const target = new Date(now);
      target.setDate(target.getDate() - i);
      const dateKey = formatLocalDateKey(target);

      const existing = activityMap.get(dateKey);
      if (existing) {
        results.push(existing);
      } else {
        results.push({
          date: dateKey,
          charactersRead: 0,
          videoImmersionSeconds: 0,
          miningVolume: 0,
          reviewsCount: 0,
          passedReviewsCount: 0,
          retentionRate: 100,
        });
      }
    }

    return results;
  }

  /** Compute overall immersion stats and streak metrics */
  async getOverallAnalytics(): Promise<OverallAnalyticsSummary> {
    const db = await this.dbPromise;
    const allActivities = await db.getAll("daily_activity");
    const todayKey = formatLocalDateKey();
    const todayActivity = (await db.get("daily_activity", todayKey)) || {
      date: todayKey,
      charactersRead: 0,
      videoImmersionSeconds: 0,
      miningVolume: 0,
      reviewsCount: 0,
      passedReviewsCount: 0,
      retentionRate: 100,
    };

    let totalCharactersRead = 0;
    let totalVideoImmersionSeconds = 0;
    let totalCardsMined = 0;
    let totalReviewsCompleted = 0;
    let totalPassedReviews = 0;

    const activityMap = new Map<string, DailyActivity>();
    for (const act of allActivities) {
      totalCharactersRead += act.charactersRead || 0;
      totalVideoImmersionSeconds += act.videoImmersionSeconds || 0;
      totalCardsMined += act.miningVolume || 0;
      totalReviewsCompleted += act.reviewsCount || 0;
      totalPassedReviews += act.passedReviewsCount || 0;
      activityMap.set(act.date, act);
    }

    // Calculate streaks
    let currentStreakDays = 0;
    let longestStreakDays = 0;
    let tempStreak = 0;

    const sortedDates = Array.from(activityMap.keys()).sort();
    
    // Check if active today or yesterday for current streak
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    const todayHasActivity = (act?: DailyActivity) =>
      act &&
      (act.charactersRead > 0 ||
        act.videoImmersionSeconds > 0 ||
        act.miningVolume > 0 ||
        act.reviewsCount > 0);

    let currPointer = new Date(checkDate);
    // If today has no activity yet, check starting from yesterday
    const todayRecord = activityMap.get(formatLocalDateKey(currPointer));
    if (!todayHasActivity(todayRecord)) {
      currPointer.setDate(currPointer.getDate() - 1);
    }

    while (true) {
      const dKey = formatLocalDateKey(currPointer);
      const act = activityMap.get(dKey);
      if (todayHasActivity(act)) {
        currentStreakDays += 1;
        currPointer.setDate(currPointer.getDate() - 1);
      } else {
        break;
      }
    }

    // Longest streak
    if (sortedDates.length > 0) {
      let prevDate: Date | null = null;
      for (const dKey of sortedDates) {
        const act = activityMap.get(dKey);
        if (!todayHasActivity(act)) continue;

        const d = new Date(dKey);
        if (prevDate) {
          const diffDays = Math.round((d.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            tempStreak += 1;
          } else {
            tempStreak = 1;
          }
        } else {
          tempStreak = 1;
        }
        prevDate = d;
        if (tempStreak > longestStreakDays) {
          longestStreakDays = tempStreak;
        }
      }
    }

    if (currentStreakDays > longestStreakDays) {
      longestStreakDays = currentStreakDays;
    }

    const averageRetentionRate =
      totalReviewsCompleted > 0
        ? Math.round((totalPassedReviews / totalReviewsCompleted) * 100)
        : 100;

    const recentDailyActivities = await this.getActivityHeatmap(120);

    return {
      totalCharactersRead,
      totalVideoImmersionSeconds,
      totalCardsMined,
      totalReviewsCompleted,
      averageRetentionRate,
      currentStreakDays,
      longestStreakDays,
      todayCharactersRead: todayActivity.charactersRead || 0,
      todayVideoImmersionSeconds: todayActivity.videoImmersionSeconds || 0,
      todayCardsMined: todayActivity.miningVolume || 0,
      todayReviewsCount: todayActivity.reviewsCount || 0,
      todayRetentionRate: todayActivity.retentionRate || 100,
      recentDailyActivities,
    };
  }
}

export const analyticsService = new AnalyticsService();

