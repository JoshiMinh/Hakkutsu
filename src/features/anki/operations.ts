/** Supported Anki search syntax, shared by every scheduling read. */
export const ANKI_ELIGIBLE = "-is:suspended -is:buried -deck:filtered";

export function checkStopped(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operation stopped", "AbortError");
}

export function wasStopped(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface SyncProgress {
  phase: "preview" | "apply" | "refresh";
  completed: number;
  total: number;
  currentId?: string;
  status?: "running" | "completed" | "failed";
}

export interface SyncOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}
