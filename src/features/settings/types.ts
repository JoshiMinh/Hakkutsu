import type { SrsAlgorithmType } from "~/features/srs/types";

export type SelectiveFuriganaMode =
  | "all"
  | "unlearned"
  | "n3_plus"
  | "n2_plus"
  | "n1_only";

export interface ExtensionSettings {
  targetLanguage: "en" | "vi" | "ja" | "zh" | "ko" | "es" | "fr" | "id";
  showHanViet: boolean;
  ankiEnabled: boolean;
  ankiDeck: string;
  ankiModel: string;
  ankiImageField: string;
  ankiFieldMap: Record<string, string>;
  includeImages: boolean;
  autoDetect: boolean;
  showFurigana: boolean;
  showJlptColors: boolean;
  hoverModifierKey: "alt" | "ctrl" | "shift" | "meta" | "none";
  theme: "dark" | "light" | "auto";
  fontSize: "small" | "medium" | "large";
  srsEnabled: boolean;
  textAnalysisEnabled: boolean;
  subtitlesEnabled: boolean;
  subtitlesFontSize: number;
  subtitlesSecondaryEnabled: boolean;
  subtitlesAutoPause: boolean;
  subtitlesOffset: number;
  netflixBtnPosition?: { x: number; y: number } | null;
  selectiveFuriganaEnabled: boolean;
  selectiveFuriganaMode: SelectiveFuriganaMode;
  webpageDensityBadgeEnabled: boolean;
  srsLeechThreshold?: number;
  srsAlgorithm?: SrsAlgorithmType;
  fsrsRequestRetention?: number;
  audioFirstReviewMode?: boolean;
  clozeReviewMode?: boolean;
  mangaOcrEnabled: boolean;
  ocrDefaultOrientation: "auto" | "vertical" | "horizontal";
  ocrPreprocessEnabled: boolean;
  ocrModel: "tesseract" | "manga-ocr";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  targetLanguage: "vi",
  showHanViet: true,
  ankiEnabled: true,
  ankiDeck: "Hakkutsu",
  ankiModel: "Hakkutsu Japanese",
  ankiImageField: "Image",
  ankiFieldMap: {},
  includeImages: true,
  autoDetect: true,
  showFurigana: true,
  showJlptColors: true,
  hoverModifierKey: "alt",
  theme: "dark",
  fontSize: "medium",
  srsEnabled: true,
  textAnalysisEnabled: true,
  subtitlesEnabled: true,
  subtitlesFontSize: 26,
  subtitlesSecondaryEnabled: true,
  subtitlesAutoPause: false,
  subtitlesOffset: 0,
  netflixBtnPosition: null,
  selectiveFuriganaEnabled: false,
  selectiveFuriganaMode: "unlearned",
  webpageDensityBadgeEnabled: true,
  srsLeechThreshold: 4,
  srsAlgorithm: "fsrs",
  fsrsRequestRetention: 0.9,
  audioFirstReviewMode: false,
  clozeReviewMode: false,
  mangaOcrEnabled: true,
  ocrDefaultOrientation: "auto",
  ocrPreprocessEnabled: true,
  ocrModel: "tesseract",
};
