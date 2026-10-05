export type SrsAlgorithmType = "fsrs" | "sm2";

export interface SmartDeckFilter {
  jlptLevels?: string[];
  domains?: string[];
  tags?: string[];
  leechesOnly?: boolean;
  dueOnly?: boolean;
  limit?: number;
}

export interface SmartDeckFilterOptions {
  jlptLevels: Array<{ level: string; count: number; dueCount: number }>;
  domains: Array<{ domain: string; count: number; dueCount: number }>;
  tags: Array<{ tag: string; count: number; dueCount: number }>;
  leechCount: number;
  dueLeechCount: number;
}
