export interface Manga {
  id: string;
  title: string;
  author: string;
  description: string;
  thumbnail: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  chapter_number: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  page_number: number;
  original_image_path: string;
  clean_image_path: string | null;
  mask_preview_path: string | null;
  bubble_preview_path: string | null;
  bubble_analysis_path: string | null;
  width: number;
  height: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TextBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source_x: number | null;
  source_y: number | null;
  source_width: number | null;
  source_height: number | null;
  original_text: string;
  ai_translation: string;
  final_translation: string;
  font_family: string;
  font_size: number;
  color: string;
  text_align: string;
  text_offset_y: number;
  placement_anchor_x: number | null;
  placement_anchor_y: number | null;
  rotation: number;
  ocr_confidence: number | null;
  ocr_provider: string | null;
  created_at: string;
  updated_at: string;
}
