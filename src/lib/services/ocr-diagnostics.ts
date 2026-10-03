import type { OcrFragment } from "./ocr-engine";

/** Supplied only by the local regression runner. Never persisted by lookup. */
export type OcrDiagnostic = {
  stage: "recognition" | "mapping" | "validation" | "recovery" | "grouping" | "overlap";
  reason: string;
  fragment?: OcrFragment;
  details?: Record<string, unknown>;
};
export type OcrDiagnosticCollector = (event: OcrDiagnostic) => void;
