/**
 * FSRS (Free Spaced Repetition Scheduler - FSRS-4.5/5) Pure TypeScript Implementation
 *
 * Implements the DSR (Difficulty, Stability, Retrievability) memory model.
 * Computes optimal review intervals based on user target retention (default: 0.90 / 90%).
 */

export type FsrsRating = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy
export type FsrsState = 0 | 1 | 2 | 3;  // 0: New, 1: Learning, 2: Review, 3: Relearning

export interface FsrsCardState {
  stability: number;       // S (in days)
  difficulty: number;      // D (scale 1.0 to 10.0)
  state: FsrsState;
  last_review: number;     // timestamp (ms)
  reps: number;
  lapses: number;
  elapsed_days: number;
  scheduled_days: number;
}

export interface FsrsReviewOutput {
  stability: number;
  difficulty: number;
  state: FsrsState;
  interval: number;        // days until next review
  due_date: number;        // timestamp (ms)
  retrievability: number;  // recall probability at review time
  reps: number;
  lapses: number;
  elapsed_days: number;
  scheduled_days: number;
}

// Canonical FSRS-4.5 / FSRS-5 default weights (19 parameters)
export const DEFAULT_FSRS_WEIGHTS: number[] = [
  0.40255, 1.18385, 3.173, 15.691, // w0-w3: Initial stability for ratings 1, 2, 3, 4
  7.1949, 0.5345,                  // w4-w5: Initial difficulty
  1.4604, 0.0046,                  // w6-w7: Difficulty update & mean reversion
  1.5457, 0.1192, 1.0192,          // w8-w10: Stability update on recall
  1.9395, 0.11, 0.296, 0.2269,     // w11-w14: Stability update on forget
  0.2315, 2.9898,                  // w15-w16: Hard penalty & Easy bonus
  0.5144, 1.2504,                  // w17-w18: Stability decay exponents
];

// FSRS Constants
const FACTOR = 19 / 81; // ~0.2345679
const DECAY = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class FsrsEngine {
  private weights: number[];
  private targetRetention: number;

  constructor(weights: number[] = DEFAULT_FSRS_WEIGHTS, targetRetention: number = 0.90) {
    this.weights = weights.length === 19 ? weights : DEFAULT_FSRS_WEIGHTS;
    this.targetRetention = clamp(targetRetention, 0.70, 0.98);
  }

  setTargetRetention(retention: number): void {
    this.targetRetention = clamp(retention, 0.70, 0.98);
  }

  /**
   * Calculates Retrievability R(t, S)
   * Probability of recalling after elapsed time t (in days) given stability S.
   */
  calculateRetrievability(elapsedDays: number, stability: number): number {
    if (stability <= 0) return 0;
    if (elapsedDays <= 0) return 1.0;
    return Math.pow(1 + (FACTOR * elapsedDays) / stability, -DECAY);
  }

  /**
   * Calculates next interval given desired retention r and stability S:
   * I(r, S) = (S / FACTOR) * (r^(-1 / DECAY) - 1)
   */
  calculateInterval(stability: number, targetRetention: number = this.targetRetention): number {
    if (stability <= 0) return 1;
    const interval = (stability / FACTOR) * (Math.pow(targetRetention, -1 / DECAY) - 1);
    return Math.max(1, Math.round(interval));
  }

  /**
   * Initial Stability S_0(G)
   */
  private initialStability(rating: FsrsRating): number {
    const idx = rating - 1;
    return Math.max(0.1, this.weights[idx] || DEFAULT_FSRS_WEIGHTS[idx]);
  }

  /**
   * Initial Difficulty D_0(G)
   */
  private initialDifficulty(rating: FsrsRating): number {
    const w4 = this.weights[4];
    const w5 = this.weights[5];
    const rawD = w4 - Math.exp(w5 * (rating - 1)) + 1;
    return clamp(rawD, 1.0, 10.0);
  }

  /**
   * Next Difficulty D'(D, G)
   */
  private nextDifficulty(currentD: number, rating: FsrsRating): number {
    const w6 = this.weights[6];
    const w7 = this.weights[7];
    const d0Good = this.initialDifficulty(3); // Mean reversion baseline
    const deltaD = -w6 * (rating - 3);
    const rawD = currentD + deltaD;
    const nextD = w7 * d0Good + (1 - w7) * rawD;
    return clamp(nextD, 1.0, 10.0);
  }

  /**
   * Stability update on successful recall (Rating 2, 3, 4)
   */
  private nextRecallStability(currentD: number, currentS: number, retrievability: number, rating: FsrsRating): number {
    const w8 = this.weights[8];
    const w9 = this.weights[9];
    const w10 = this.weights[10];
    const w15 = this.weights[15]; // hard penalty
    const w16 = this.weights[16]; // easy bonus

    const hardPenalty = rating === 2 ? w15 : 1.0;
    const easyBonus = rating === 4 ? w16 : 1.0;

    const modifier = 1 + Math.exp(w8) * (11 - currentD) * Math.pow(currentS, -w9) * (Math.exp(w10 * (1 - retrievability)) - 1) * hardPenalty * easyBonus;
    return Math.max(currentS, currentS * modifier);
  }

  /**
   * Stability update on failure/forget (Rating 1)
   */
  private nextForgetStability(currentD: number, currentS: number, retrievability: number): number {
    const w11 = this.weights[11];
    const w12 = this.weights[12];
    const w13 = this.weights[13];
    const w14 = this.weights[14];

    const sForget = w11 * Math.pow(currentD, -w12) * (Math.pow(currentS + 1, w13) - 1) * Math.exp(w14 * (1 - retrievability));
    return clamp(sForget, 0.1, currentS);
  }

  /**
   * Processes a review turn and returns the updated FSRS memory state and next schedule.
   */
  review(currentState: Partial<FsrsCardState>, rating: FsrsRating, now: number = Date.now()): FsrsReviewOutput {
    const isNew = !currentState.last_review || (currentState.state === 0 || currentState.state === undefined);
    const lastReview = currentState.last_review || now;
    const elapsedDays = isNew ? 0 : Math.max(0, (now - lastReview) / 86400000);

    let nextS: number;
    let nextD: number;
    let nextState: FsrsState;
    let retrievability = 1.0;
    const reps = (currentState.reps || 0) + 1;
    let lapses = currentState.lapses || 0;

    if (isNew) {
      // First time reviewing card
      nextS = this.initialStability(rating);
      nextD = this.initialDifficulty(rating);
      nextState = rating === 1 ? 1 : 2;
      if (rating === 1) lapses += 1;
    } else {
      const currentS = Math.max(0.1, currentState.stability || this.initialStability(3));
      const currentD = clamp(currentState.difficulty || this.initialDifficulty(3), 1.0, 10.0);
      retrievability = this.calculateRetrievability(elapsedDays, currentS);
      nextD = this.nextDifficulty(currentD, rating);

      if (rating === 1) {
        // Forgotten
        nextS = this.nextForgetStability(nextD, currentS, retrievability);
        nextState = 3; // Relearning
        lapses += 1;
      } else {
        // Recalled
        nextS = this.nextRecallStability(nextD, currentS, retrievability, rating);
        nextState = 2; // Review
      }
    }

    let interval = rating === 1 ? 1 : this.calculateInterval(nextS, this.targetRetention);
    if (rating === 2) {
      // Hard interval cap: between 1 and good interval
      interval = Math.max(1, Math.min(interval, Math.round(nextS * 0.8)));
    } else if (rating === 4) {
      // Easy interval bonus
      interval = Math.max(interval + 1, Math.round(interval * 1.3));
    }

    const dueDate = now + interval * 86400000;

    return {
      stability: Math.round(nextS * 1000) / 1000,
      difficulty: Math.round(nextD * 1000) / 1000,
      state: nextState,
      interval,
      due_date: dueDate,
      retrievability: Math.round(retrievability * 1000) / 1000,
      reps,
      lapses,
      elapsed_days: Math.round(elapsedDays * 10) / 10,
      scheduled_days: interval,
    };
  }
}

export const fsrsEngine = new FsrsEngine();
