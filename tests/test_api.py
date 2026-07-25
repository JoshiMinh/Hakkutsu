import io
import html
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
import numpy as np

import app.database as database
import app.main as main
import app.quality_service as quality_service
from app.ctd_mask_service import _fill_long_sfx_gaps, _stabilize_long_sfx_mask
from app.ocr_service import (
    DetectedRegion,
    OcrRegion,
    choose_recognized_text,
    detected_regions_from_comic_model,
    group_fallback_regions,
    group_detected_regions,
    tile_boxes,
)
from app.translation_service import (
    MissingTranslationsError,
    TranslationBlock,
    parse_translation_response,
    translate_blocks_resilient,
)
from app.study_analysis_service import _ai_enrich, _ai_enrich_batch
from app.media_service import (
    SubtitleCue,
    YouTubeSubtitleResult,
    extension_analysis,
    parse_subtitle_text,
    youtube_video_id,
)
from app.inpainting_service import (
    UnsafeTextMaskError,
    create_primary_text_mask,
    create_text_mask,
    evaluate_inpainting_result,
    inpaint_text_regions,
    inpaint_text_regions_hybrid,
    shrink_unsafe_text_mask,
    validate_text_mask_safety,
)
from app.text_policy_service import classify_text_policies
from app.visual_supervisor_service import _parse_response, merge_visual_policies
from app.bubble_segmentation_service import (
    analyze_bubble_instances,
    recover_missing_japanese_fragments,
    render_bubble_preview,
    safe_row_spans,
)
from app.typesetting_service import (
    constrain_cell_to_bubble_interior,
    fit_text_away_from_art,
    fit_text_layout,
    pack_grouped_text_fallback,
    partition_text_regions_by_source,
    place_text_in_clear_area,
    render_translated_page,
    text_layout_bounds,
)
from app.tonarinoyj_service import descramble_tonari_bytes, descramble_tonari_image, parse_episode_html


def sample_png(width: int = 320, height: int = 480) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG")
    return output.getvalue()


def sample_text_png(width: int = 320, height: int = 480) -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", (width, height), "white")
    ImageDraw.Draw(image).text((40, 40), "TEXT", fill="black", stroke_width=1)
    image.save(output, format="PNG")
    return output.getvalue()


class ApiFlowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        database.DATABASE_PATH = root / "test.db"
        main.UPLOAD_DIR = root / "uploads"
        main.UPLOAD_DIR.mkdir(parents=True)
        quality_service.UPLOAD_DIR = main.UPLOAD_DIR
        main.STUDY_ASSET_DIR = root / "study"
        main.STUDY_ASSET_DIR.mkdir(parents=True)
        self.client_context = TestClient(main.app)
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def create_page(self) -> int:
        manga = self.client.post("/api/manga", json={"title": "Test Manga"})
        self.assertEqual(manga.status_code, 201)
        chapter = self.client.post(
            f"/api/manga/{manga.json()['id']}/chapters",
            json={"chapter_number": "1", "title": "Khởi đầu"},
        )
        self.assertEqual(chapter.status_code, 201)
        page = self.client.post(
            f"/api/chapters/{chapter.json()['id']}/pages",
            files=[("files", ("001.png", sample_png(), "image/png"))],
        )
        self.assertEqual(page.status_code, 201, page.text)
        return page.json()[0]["id"]

    def test_media_import_subtitle_analyze_and_extension_adapter(self) -> None:
        imported = self.client.post(
            "/api/media/import",
            json={
                "title": "Tập thử nghiệm",
                "source_type": "manual",
                "source_url": "https://example.test/video",
                "segments": [
                    {"text": "今日はいい天気ですね。", "start": 3.5, "duration": 2.0},
                    {"text": "行きましょう。", "start": 6.0, "duration": 1.5},
                ],
            },
        )
        self.assertEqual(imported.status_code, 201, imported.text)
        source = imported.json()
        self.assertEqual(source["segment_count"], 2)
        self.assertEqual(source["segments"][0]["start_time"], 3.5)

        analysis = {
            "text": "今日はいい天気ですね。",
            "translation": "Hôm nay trời đẹp nhỉ.",
            "analysis": {
                "tokens": [{"surface": "今日", "lemma": "今日", "reading": "キョウ", "meaning_vi": "hôm nay"}],
                "grammar": [],
            },
        }
        with patch("app.main._translate_and_analyze_media", return_value=analysis):
            analyzed = self.client.post(f"/api/media/segments/{source['segments'][0]['id']}/analyze")
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        self.assertEqual(analyzed.json()["translation"], "Hôm nay trời đẹp nhỉ.")
        refreshed = self.client.get(f"/api/media/{source['id']}").json()
        self.assertEqual(refreshed["analyzed_count"], 1)
        self.assertEqual(refreshed["segments"][0]["analysis"]["tokens"][0]["meaning_vi"], "hôm nay")

        extension_shape = {
            "text": "日本語",
            "tokens": [],
            "sentence_reading": "",
            "token_count": 0,
            "difficulty_score": None,
            "difficulty_label": None,
            "grammar_patterns": [],
        }
        with patch("app.main.extension_analysis", return_value=extension_shape) as fast_analysis:
            response = self.client.post(
                "/api/v1/analyze",
                json={"text": "日本語", "include_definitions": False},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"], "日本語")
        fast_analysis.assert_called_once_with("日本語", include_definitions=False)

    def test_javi_analysis_uses_deterministic_fallback_while_disabled(self) -> None:
        fallback = {
            "text": "食べました",
            "tokens": [],
            "grammar_patterns": [],
        }
        with (
            patch.object(main, "JAVI_ANALYSIS_ENABLED", False),
            patch("app.main._extension_analysis_with_srs", return_value=fallback),
            patch("app.main.analyze_phrase_javi") as model_analysis,
        ):
            response = self.client.post(
                "/api/v1/analyze/javi",
                json={"text": "食べました", "include_definitions": True},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["analysis_engine"], "sudachi-jmdict")
        model_analysis.assert_not_called()

    def test_javi_analysis_merges_vietnamese_model_output_when_enabled(self) -> None:
        local = {
            "text": "食べました",
            "tokens": [
                {
                    "surface": "食べました",
                    "components": [
                        {"surface": "食べ"},
                        {"surface": "まし"},
                        {"surface": "た"},
                    ],
                    "definitions": [],
                }
            ],
            "grammar_patterns": [],
        }
        enriched = {
            "translation": "Đã ăn.",
            "meanings_vi": ["ăn", "lịch sự", "quá khứ"],
            "grammar": [
                {
                    "pattern": "ました",
                    "span": "ました",
                    "explanation_vi": "Dạng quá khứ lịch sự của động từ.",
                }
            ],
        }
        with (
            patch.object(main, "JAVI_ANALYSIS_ENABLED", True),
            patch.object(main, "JAVI_ANALYSIS_MODEL", "hakkutsu-javi:test"),
            patch("app.main._extension_analysis_with_srs", return_value=local),
            patch("app.main.analyze_phrase_javi", return_value=enriched),
        ):
            response = self.client.post(
                "/api/v1/analyze/javi",
                json={"text": "食べました", "include_definitions": True},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["translation"], "Đã ăn.")
        self.assertEqual(body["analysis_engine"], "hakkutsu-javi:test")
        self.assertEqual(
            body["tokens"][0]["definitions"][0]["glosses"],
            ["ăn"],
        )
        self.assertEqual(body["grammar_patterns"][0]["pattern"], "ました")
        self.assertIn("quá khứ", body["grammar_patterns"][0]["explanation"])

    def test_subtitle_file_upload_and_parser(self) -> None:
        content = """WEBVTT

00:00:01.000 --> 00:00:03.500
<c.ja>こんにちは。</c>

00:00:04.000 --> 00:00:06.000
元気ですか？
"""
        cues = parse_subtitle_text(content)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text, "こんにちは。")
        self.assertEqual(cues[0].duration, 2.5)
        self.assertEqual(youtube_video_id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

        response = self.client.post(
            "/api/media/import-subtitle",
            data={"title": "Phim thử"},
            files={"file": ("episode.vtt", content.encode("utf-8"), "text/vtt")},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["title"], "Phim thử")
        self.assertEqual(response.json()["segment_count"], 2)

    def test_extension_youtube_subtitle_endpoint_reports_selected_track(self) -> None:
        fetched = YouTubeSubtitleResult(
            video_id="hzxvHyn3IZo",
            language_code="ja",
            track_name="Japanese",
            is_generated=False,
            cues=[SubtitleCue("日本語の字幕", 1.25, 2.5)],
        )
        with patch("app.main.fetch_youtube_subtitle_result", return_value=fetched):
            response = self.client.post(
                "/api/v1/subtitles/youtube",
                json={
                    "video_url": "https://www.youtube.com/watch?v=hzxvHyn3IZo",
                    "language": "ja",
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["track_name"], "Japanese")
        self.assertFalse(payload["is_auto_generated"])
        self.assertEqual(payload["segments"][0]["text"], "日本語の字幕")

    def test_extension_phrase_analysis_is_explicit_ai_path(self) -> None:
        fast_shape = {
            "text": "猫が好き",
            "tokens": [
                {
                    "surface": "猫",
                    "dictionary_form": "猫",
                    "reading": {"hiragana": "ねこ", "romaji": ""},
                    "pos": "名詞",
                    "pos_detail": [],
                    "is_japanese": True,
                    "jlpt_level": None,
                    "frequency_rank": None,
                    "definitions": [],
                    "srs_state": "new",
                }
            ],
            "sentence_reading": "ねこ",
            "token_count": 1,
            "difficulty_score": None,
            "difficulty_label": None,
            "grammar_patterns": [],
        }
        deep_shape = {
            "translation": "Tôi thích mèo.",
            "meanings_vi": ["mèo"],
            "grammar": [
                {
                    "pattern": "が好き",
                    "explanation_vi": "Diễn tả việc thích một đối tượng.",
                }
            ],
        }
        with (
            patch("app.main.analyze_phrase_deep", return_value=deep_shape) as deep,
            patch("app.main._extension_analysis_with_srs", return_value=fast_shape),
        ):
            response = self.client.post(
                "/api/v1/analyze/phrase",
                json={"text": "猫が好き", "context_type": "subtitle"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["translation"], "Tôi thích mèo.")
        self.assertEqual(payload["tokens"][0]["definitions"][0]["glosses"], ["mèo"])
        self.assertEqual(payload["grammar_patterns"][0]["pattern"], "が好き")
        deep.assert_called_once()

    def test_fast_extension_analysis_uses_local_grammar_knowledge(self) -> None:
        result = extension_analysis("今は減税すべき時じゃないと思うんですね。")
        patterns = {item["pattern"] for item in result["grammar_patterns"]}
        self.assertIn("べき", patterns)
        self.assertIn("と思う", patterns)
        self.assertIn("んです", patterns)
        self.assertGreater(len(result["tokens"]), 0)

    def test_extension_analysis_groups_polite_past_inflection(self) -> None:
        result = extension_analysis("正しました", include_definitions=False)
        self.assertEqual(len(result["tokens"]), 1)
        token = result["tokens"][0]
        self.assertEqual(token["surface"], "正しました")
        self.assertEqual(token["dictionary_form"], "正す")
        self.assertEqual(
            [item["lemma"] for item in token["components"]],
            ["正す", "ます", "た"],
        )
        self.assertIn("lịch sự", token["grammar_note_vi"])
        self.assertIn("quá khứ", token["grammar_note_vi"])

    def test_extension_webpage_translation_batches_text_and_returns_tokens(self) -> None:
        token_result = {
            "text": "猫が好きです。",
            "tokens": [{"surface": "猫", "dictionary_form": "猫", "is_japanese": True}],
            "sentence_reading": "ねこ",
            "token_count": 1,
            "difficulty_score": None,
            "difficulty_label": None,
            "grammar_patterns": [],
        }
        with (
            patch("app.main.get_translation_provider", return_value=object()),
            patch(
                "app.main.translate_blocks_resilient",
                return_value={0: "Tôi thích mèo.", 1: "Chào buổi sáng."},
            ) as translate,
            patch("app.main.extension_analysis", return_value=token_result),
        ):
            response = self.client.post(
                "/api/v1/translate",
                json={
                    "texts": ["猫が好きです。", "おはよう。"],
                    "page_url": "https://example.test/article",
                    "page_title": "Bài đọc",
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["target_language"], "vi")
        self.assertEqual(payload["items"][0]["translation"], "Tôi thích mèo.")
        self.assertEqual(payload["items"][0]["tokens"][0]["surface"], "猫")
        blocks = translate.call_args.args[1]
        self.assertEqual([block.text for block in blocks], ["猫が好きです。", "おはよう。"])
        self.assertEqual(translate.call_args.args[2]["content_type"], "webpage")

    def test_editor_page_management_reorder_review_and_delete(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Quản lý trang"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "1"}
        ).json()
        uploaded = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[
                ("files", ("001.png", sample_png(300, 450), "image/png")),
                ("files", ("002.png", sample_png(301, 450), "image/png")),
                ("files", ("003.png", sample_png(302, 450), "image/png")),
            ],
        ).json()
        page_ids = [item["id"] for item in uploaded]
        reordered = [page_ids[2], page_ids[0], page_ids[1]]
        response = self.client.put(
            f"/api/chapters/{chapter['id']}/pages/order", json={"page_ids": reordered}
        )
        self.assertEqual(response.status_code, 200, response.text)
        page = self.client.get(f"/api/pages/{page_ids[0]}").json()
        self.assertEqual([item["id"] for item in page["chapter_pages"]], reordered)

        saved = self.client.put(f"/api/pages/{page_ids[0]}/text-blocks", json={"blocks": []})
        self.assertEqual(saved.status_code, 200, saved.text)
        approved = self.client.post(f"/api/pages/{page_ids[0]}/review", json={"approved": True})
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(self.client.get(f"/api/pages/{page_ids[0]}").json()["workflow_state"], "completed")

        deleted = self.client.delete(f"/api/pages/{page_ids[0]}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        remaining_page = self.client.get(f"/api/pages/{page_ids[1]}").json()
        self.assertEqual([item["page_number"] for item in remaining_page["chapter_pages"]], [1, 2])
        removed_chapter = self.client.delete(f"/api/chapters/{chapter['id']}")
        self.assertEqual(removed_chapter.status_code, 200, removed_chapter.text)
        self.assertEqual(self.client.get(f"/api/pages/{page_ids[1]}").status_code, 404)

    def test_health_and_empty_library(self) -> None:
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")
        self.assertEqual(self.client.get("/api/manga").json(), [])
        visual = self.client.get("/api/visual-supervisor/status")
        self.assertEqual(visual.status_code, 200)
        self.assertIn("model", visual.json())

    def test_visual_supervisor_schema_and_policy_keep_japanese_replaceable(self) -> None:
        parsed = _parse_response(json.dumps({
            "decisions": [{
                "block_id": 7,
                "content_type": "skill",
                "action": "preserve",
                "style_preset": "skill",
                "mask_strategy": "aggressive",
                "confidence": 0.95,
                "reason": "Large outlined skill text",
            }],
            "page_note": "Large display text",
        }), {7})
        merged = merge_visual_policies(
            {7: {
                "text_kind": "sfx", "content_type": "sfx",
                "translation_mode": "translate", "render_mode": "preserve",
                "style_preset": "action", "font_family": "Impact",
                "sfx_score": 0.8, "policy_reasons": [],
            }},
            parsed,
            [{"id": 7, "original_text": "閃光拳"}],
        )
        self.assertEqual(merged[7]["render_mode"], "replace")
        self.assertEqual(merged[7]["content_type"], "skill")
        self.assertEqual(merged[7]["mask_strategy"], "aggressive")
        self.assertEqual(merged[7]["visual_confidence"], 0.95)

    def test_manual_block_preserves_separate_qwen_suggestion(self) -> None:
        page_id = self.create_page()
        suggestion = {
            "model": "qwen3.5:9b", "action": "replace", "effective_action": "replace",
            "content_type": "sfx", "mask_strategy": "aggressive",
            "confidence": 0.93, "reason": "Large display text",
        }
        saved = self.client.put(f"/api/pages/{page_id}/text-blocks", json={"blocks": [{
            "x": 20, "y": 20, "width": 120, "height": 150,
            "original_text": "閃光拳", "policy_source": "manual",
            "visual_suggestion_json": json.dumps(suggestion),
        }]})
        self.assertEqual(saved.status_code, 200, saved.text)
        block = self.client.get(f"/api/pages/{page_id}").json()["text_blocks"][0]
        self.assertEqual(block["policy_source"], "manual")
        self.assertEqual(block["visual_suggestion"]["model"], "qwen3.5:9b")
        self.assertEqual(block["visual_suggestion"]["mask_strategy"], "aggressive")

    def test_outside_text_policy_is_available_before_ocr_and_respects_manual_blocks(self) -> None:
        page_id = self.create_page()
        saved = self.client.put(
            f"/api/pages/{page_id}/outside-text-policy", json={"policy": "study"}
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(
            self.client.get(f"/api/pages/{page_id}").json()["outside_text_policy"], "study"
        )

        blocks = [
            {
                "x": 10, "y": 10, "width": 100, "height": 80,
                "original_text": "必殺技", "text_kind": "sfx", "content_type": "skill",
                "translation_mode": "translate", "render_mode": "preserve",
                "style_preset": "skill", "policy_source": "auto", "sfx_score": 0.9,
            },
            {
                "x": 130, "y": 10, "width": 100, "height": 80,
                "original_text": "ドン", "text_kind": "sfx", "content_type": "sfx",
                "translation_mode": "skip", "render_mode": "preserve",
                "style_preset": "action", "policy_source": "manual", "sfx_score": 0.9,
            },
        ]
        response = self.client.put(
            f"/api/pages/{page_id}/text-blocks", json={"blocks": blocks}
        )
        self.assertEqual(response.status_code, 200, response.text)
        changed = self.client.put(
            f"/api/pages/{page_id}/outside-text-policy", json={"policy": "replace"}
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        current = self.client.get(f"/api/pages/{page_id}").json()["text_blocks"]
        self.assertEqual(current[0]["render_mode"], "replace")
        self.assertEqual(current[0]["translation_mode"], "translate")
        self.assertEqual(current[1]["render_mode"], "preserve")
        self.assertEqual(current[1]["translation_mode"], "skip")

    def test_skipped_region_does_not_require_translation_or_clean_image(self) -> None:
        page_id = self.create_page()
        block = {
            "x": 10, "y": 10, "width": 100, "height": 80,
            "original_text": "ドン", "text_kind": "sfx", "content_type": "sfx",
            "translation_mode": "skip", "render_mode": "preserve",
            "style_preset": "action", "policy_source": "manual",
        }
        response = self.client.put(
            f"/api/pages/{page_id}/text-blocks", json={"blocks": [block]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        checked = self.client.post(f"/api/pages/{page_id}/quality-check")
        self.assertEqual(checked.status_code, 200, checked.text)
        self.assertEqual(checked.json()["status"], "pass")

    def test_tonari_episode_marks_baku_images_as_scrambled(self) -> None:
        payload = {
            "readableProduct": {
                "id": "episode-1",
                "pageStructure": {
                    "choJuGiga": "baku",
                    "pages": [{
                        "type": "main", "src": "https://example.test/page.jpg",
                        "width": 800, "height": 1150,
                    }],
                },
                "series": {"id": "series-1", "title": "Test"},
            }
        }
        encoded = html.escape(json.dumps(payload), quote=True)
        parsed = parse_episode_html(f'<div id="episode-json" data-value="{encoded}"></div>')
        self.assertTrue(parsed["image_scramble"])
        self.assertEqual(parsed["page_count"], 1)

    def test_tonari_tile_descramble_restores_original_and_remainder(self) -> None:
        original = Image.new("RGB", (70, 75), "magenta")
        draw = ImageDraw.Draw(original)
        cell_width, cell_height = 16, 16
        for row in range(4):
            for column in range(4):
                draw.rectangle(
                    (column * cell_width, row * cell_height,
                     (column + 1) * cell_width - 1, (row + 1) * cell_height - 1),
                    fill=(row * 50, column * 50, 20 + row * 4 + column),
                )
        scrambled = descramble_tonari_image(original)
        restored = descramble_tonari_image(scrambled)
        self.assertTrue(np.array_equal(np.asarray(restored), np.asarray(original)))
        self.assertEqual(restored.getpixel((69, 74)), (255, 0, 255))

        output = descramble_tonari_bytes(
            (lambda stream: (original.save(stream, format="PNG"), stream.getvalue())[1])(io.BytesIO()),
            ".png",
        )
        with Image.open(io.BytesIO(output)) as decoded:
            self.assertEqual(decoded.size, original.size)

    def test_tonari_import_marks_and_rejects_existing_chapters(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Tonari Test"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters",
            json={"chapter_number": "1", "title": "Episode đã nhập"},
        ).json()
        with database.db_session() as connection:
            connection.execute(
                """UPDATE chapters SET source_provider = 'tonarinoyj', source_episode_id = ?
                   WHERE id = ?""",
                ("12345", chapter["id"]),
            )

        source_result = {
            "series": {"id": "999", "title": "Tonari Test"},
            "episodes": [
                {"episode_id": "12345", "title": "Đã nhập", "is_public": True},
                {"episode_id": "67890", "title": "Chưa nhập", "is_public": True},
            ],
        }
        with patch.object(main, "list_series_episodes", return_value=source_result):
            response = self.client.get("/api/sources/tonarinoyj/series/999")
        self.assertEqual(response.status_code, 200, response.text)
        episodes = response.json()["episodes"]
        self.assertTrue(episodes[0]["already_imported"])
        self.assertEqual(episodes[0]["chapter_id"], chapter["id"])
        self.assertFalse(episodes[1]["already_imported"])
        self.assertIsNone(episodes[1]["chapter_id"])

        duplicate = self.client.post(
            "/api/sources/tonarinoyj/import",
            json={"series_id": "999", "episode_ids": ["12345"]},
        )
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertIn("đã có trong thư viện", duplicate.json()["detail"])

    def test_quality_warning_requires_explicit_override(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        block = {
            "x": 10, "y": 10, "width": 120, "height": 80,
            "original_text": "こんにちは", "ai_translation": "こんにちは",
            "final_translation": "Xin chào 日本", "font_size": 20,
        }
        self.client.put(f"/api/pages/{page_id}/text-blocks", json={"blocks": [block]})
        with database.db_session() as connection:
            connection.execute(
                "UPDATE pages SET clean_image_path = original_image_path WHERE id = ?", (page_id,)
            )
        with patch("app.quality_service.recognize_japanese_crop", return_value=""):
            checked = self.client.post(f"/api/pages/{page_id}/quality-check")
        self.assertEqual(checked.json()["status"], "warning")
        rejected = self.client.post(f"/api/pages/{page_id}/review", json={"approved": True})
        self.assertEqual(rejected.status_code, 409)
        approved = self.client.post(
            f"/api/pages/{page_id}/review",
            json={"approved": True, "override_warnings": True},
        )
        self.assertEqual(approved.status_code, 200)

    def test_chapter_can_explicitly_accept_warnings_but_not_silently(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        block = {
            "x": 10, "y": 10, "width": 120, "height": 80,
            "original_text": "こんにちは", "ai_translation": "Xin chào 日本",
            "final_translation": "Xin chào 日本", "font_size": 20,
        }
        self.client.put(f"/api/pages/{page_id}/text-blocks", json={"blocks": [block]})
        with database.db_session() as connection:
            connection.execute(
                "UPDATE pages SET clean_image_path = original_image_path, status = 'ready' WHERE id = ?",
                (page_id,),
            )
        with patch("app.quality_service.recognize_japanese_crop", return_value=""):
            checked = self.client.post(f"/api/pages/{page_id}/quality-check")
        self.assertEqual(checked.json()["status"], "warning")

        rejected = self.client.post(
            f"/api/chapters/{page['chapter_id']}/review",
            json={"approved": True, "override_warnings": False},
        )
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertIn("cảnh báo QA", rejected.json()["detail"])

        approved = self.client.post(
            f"/api/chapters/{page['chapter_id']}/review",
            json={"approved": True, "override_warnings": True},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        updated = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(updated["review_status"], "approved")
        self.assertEqual(updated["qa_overridden"], 1)

    def test_preserve_sfx_decision_allows_no_text_page_to_publish(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        checked = self.client.post(f"/api/pages/{page_id}/quality-check")
        self.assertEqual(checked.status_code, 200, checked.text)
        self.assertEqual(checked.json()["status"], "warning")
        self.assertEqual(checked.json()["issues"][0]["code"], "no_dialogue_or_sfx_review")

        rejected = self.client.post(f"/api/pages/{page_id}/review", json={"approved": True})
        self.assertEqual(rejected.status_code, 409)

        decided = self.client.put(
            f"/api/pages/{page_id}/editorial-decision",
            json={"decision": "preserve_sfx"},
        )
        self.assertEqual(decided.status_code, 200, decided.text)
        self.assertEqual(decided.json()["quality"]["status"], "pass")
        updated = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(updated["editorial_decision"], "preserve_sfx")
        self.assertEqual(updated["qa_status"], "pass")
        self.assertEqual(updated["clean_image_path"], updated["original_image_path"])

        approved = self.client.post(f"/api/pages/{page_id}/review", json={"approved": True})
        self.assertEqual(approved.status_code, 200, approved.text)
        exported = self.client.get(f"/api/pages/{page_id}/export.png")
        self.assertEqual(exported.status_code, 200, exported.text)

        reviewed = self.client.post(f"/api/chapters/{page['chapter_id']}/review", json={"approved": True})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        published = self.client.post(f"/api/chapters/{page['chapter_id']}/publish")
        self.assertEqual(published.status_code, 202, published.text)
        publish_job = self.client.get(f"/api/jobs/{published.json()['job_id']}").json()
        self.assertEqual(publish_job["status"], "completed")
        snapshot = self.client.get(f"/api/study/chapters/{page['chapter_id']}").json()
        self.assertEqual(snapshot["pages"][0]["editorial_decision"], "preserve_sfx")
        self.assertEqual(snapshot["pages"][0]["blocks"], [])

    def test_publish_creates_stable_study_snapshot_and_vocabulary_deduplicates(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        self.client.put(f"/api/pages/{page_id}/text-blocks", json={"blocks": [{
            "x": 20, "y": 20, "width": 140, "height": 70,
            "original_text": "食べたい", "ai_translation": "Tôi muốn ăn",
            "final_translation": "Tôi muốn ăn", "font_size": 20,
        }]})
        with database.db_session() as connection:
            connection.execute(
                "UPDATE pages SET clean_image_path = original_image_path, qa_status = 'pass' WHERE id = ?",
                (page_id,),
            )
        self.client.post(f"/api/pages/{page_id}/review", json={"approved": True})
        reviewed = self.client.post(f"/api/chapters/{page['chapter_id']}/review", json={"approved": True})
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        analysis = {"tokens": [{"surface": "食べたい", "lemma": "食べる", "reading": "タベル", "meaning_vi": "ăn", "part_of_speech": "động từ"}], "grammar": [{"pattern": "たい", "explanation_vi": "muốn làm"}]}
        with patch("app.main.analyze_sentences", return_value=[analysis]):
            published = self.client.post(f"/api/chapters/{page['chapter_id']}/publish")
        self.assertEqual(published.status_code, 202, published.text)
        publish_job = self.client.get(f"/api/jobs/{published.json()['job_id']}").json()
        self.assertEqual(publish_job["status"], "completed")
        snapshot = self.client.get(f"/api/study/chapters/{page['chapter_id']}").json()
        self.assertEqual(snapshot["pages"][0]["blocks"][0]["analysis"], analysis)
        payload = {"lemma": "食べる", "reading": "タベル", "surface": "食べたい", "meaning_vi": "ăn"}
        first = self.client.post("/api/vocabulary", json=payload)
        second = self.client.post("/api/vocabulary", json=payload)
        self.assertEqual(first.status_code, 201)
        self.assertTrue(second.json()["already_saved"])
        self.assertEqual(len(self.client.get("/api/vocabulary").json()), 1)

    def test_study_batch_analysis_falls_back_when_group_json_is_truncated(self) -> None:
        class TruncatedResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"choices": [{"message": {"content": "{\"results\":{\"0\":{\"meanings_vi\":[\"bị cắt"}}]}

        items = [
            {"text": "猫", "translation": "mèo", "tokens": [{"surface": "猫"}]},
            {"text": "犬", "translation": "chó", "tokens": [{"surface": "犬"}]},
        ]
        fallback = [
            {"tokens": [{"surface": "猫", "meaning_vi": "mèo"}], "grammar": []},
            {"tokens": [{"surface": "犬", "meaning_vi": "chó"}], "grammar": []},
        ]
        with (
            patch("app.study_analysis_service.httpx.post", return_value=TruncatedResponse()),
            patch("app.study_analysis_service._ai_enrich", side_effect=fallback) as single_analysis,
        ):
            result = _ai_enrich_batch(items)
        self.assertEqual(result, fallback)
        self.assertEqual(single_analysis.call_count, 2)

    def test_study_single_analysis_uses_compact_meaning_list(self) -> None:
        class CompactResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                content = json.dumps({
                    "meanings_vi": ["mèo", "thích"],
                    "grammar": [{"pattern": "が好き", "explanation_vi": "thích một đối tượng"}],
                }, ensure_ascii=False)
                return {"choices": [{"message": {"content": content}}]}

        tokens = [{"surface": "猫", "lemma": "猫"}, {"surface": "好き", "lemma": "好き"}]
        with patch("app.study_analysis_service.httpx.post", return_value=CompactResponse()):
            result = _ai_enrich("猫が好き", "Tôi thích mèo", tokens)
        self.assertEqual([item["meaning_vi"] for item in result["tokens"]], ["mèo", "thích"])
        self.assertEqual(result["grammar"][0]["pattern"], "が好き")

    def test_chapter_batch_runs_pages_in_order_and_reports_items(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Batch"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "3"}
        ).json()
        pages = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[
                ("files", ("001.png", sample_png(), "image/png")),
                ("files", ("002.png", sample_png(321, 480), "image/png")),
            ],
        ).json()
        order = []

        def complete_pipeline(job_id, page_id, *args):
            order.append(page_id)
            with database.db_session() as connection:
                connection.execute(
                    "UPDATE processing_jobs SET status = 'completed', progress = 1, result_count = 1 WHERE id = ?",
                    (job_id,),
                )
                connection.execute(
                    "UPDATE pages SET status = 'ready', qa_status = 'pass' WHERE id = ?", (page_id,)
                )

        with patch("app.main.run_full_pipeline_job", side_effect=complete_pipeline):
            started = self.client.post(
                f"/api/chapters/{chapter['id']}/pipeline", json={"include_warnings": True}
            )
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(order, [page["id"] for page in pages])
        self.assertEqual(job["status"], "completed")
        self.assertEqual([item["status"] for item in job["items"]], ["completed", "completed"])

    def test_chapter_batch_does_not_rerun_ready_pass_page(self) -> None:
        page_id = self.create_page()
        with database.db_session() as connection:
            connection.execute(
                "UPDATE pages SET status = 'ready', qa_status = 'pass', clean_image_path = original_image_path WHERE id = ?",
                (page_id,),
            )
            chapter_id = connection.execute(
                "SELECT chapter_id FROM pages WHERE id = ?", (page_id,)
            ).fetchone()[0]
        started = self.client.post(
            f"/api/chapters/{chapter_id}/pipeline", json={"include_warnings": True}
        )
        self.assertEqual(started.status_code, 409, started.text)

    def test_raw_ctd_only_fills_undercovered_sfx_slice(self) -> None:
        refined = np.zeros((120, 80), dtype=np.uint8)
        raw = np.zeros_like(refined)
        gray = np.full_like(refined, 230)
        refined[10:35, 20:50] = 255
        raw[70:110, 18:55] = 255
        gray[75:105, 24:48] = 20
        completed = _fill_long_sfx_gaps(
            refined, raw, [(15, 5, 45, 110)], gray
        )
        self.assertGreater(int(np.count_nonzero(completed[70:110, 18:55])), 0)
        self.assertEqual(int(np.count_nonzero(completed[:, :10])), 0)

    def test_pathological_sfx_gap_fill_recovers_aligned_glyphs_not_slab(self) -> None:
        refined = np.zeros((240, 160), dtype=np.uint8)
        gray = np.full_like(refined, 235)
        # Three aligned, outlined display glyph bodies and an unrelated dark
        # artwork component to their left.
        glyphs = [(70, 20, 142, 70), (69, 88, 141, 138), (70, 154, 142, 210)]
        for left, top, right, bottom in glyphs:
            gray[top:bottom, left:right] = 20
            refined[top + 4:top + 10, left + 5:left + 18] = 255
        gray[25:215, 25:62] = 15
        gap_filled = np.zeros_like(refined)
        gap_filled[10:225, 18:145] = 255
        stable = _stabilize_long_sfx_mask(
            refined, gap_filled, [(15, 8, 135, 220)], gray
        )
        original_coverage = float(np.mean(gap_filled[8:228, 15:150] > 0))
        stable_coverage = float(np.mean(stable[8:228, 15:150] > 0))
        self.assertGreater(original_coverage, 0.75)
        self.assertLess(stable_coverage, original_coverage * 0.75)
        self.assertGreater(int(np.count_nonzero(stable[20:210, 70:132])), 0)
        self.assertEqual(int(np.count_nonzero(stable[25:215, 25:62])), 0)

    def test_create_upload_and_save_text_block(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}")
        self.assertEqual(page.status_code, 200)
        self.assertEqual((page.json()["width"], page.json()["height"]), (320, 480))

        save = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={
                "blocks": [
                    {
                        "x": 20,
                        "y": 30,
                        "width": 120,
                        "height": 80,
                        "original_text": "こんにちは",
                        "ai_translation": "Xin chào",
                        "final_translation": "Chào bạn",
                        "font_family": "Arial",
                        "font_size": 24,
                        "color": "#000000",
                        "text_align": "center",
                        "rotation": 0,
                    }
                ]
            },
        )
        self.assertEqual(save.status_code, 200, save.text)
        loaded = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(loaded["text_blocks"][0]["final_translation"], "Chào bạn")

    def test_reject_duplicate_chapter_and_out_of_bounds_block(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        duplicate = self.client.post(
            f"/api/manga/{page['manga_id']}/chapters", json={"chapter_number": "1"}
        )
        self.assertEqual(duplicate.status_code, 409)

        invalid = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{"x": 300, "y": 20, "width": 100, "height": 50}]},
        )
        self.assertEqual(invalid.status_code, 422)

    def test_reject_non_image_upload(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Test"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "1"}
        ).json()
        result = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[("files", ("bad.txt", b"not an image", "text/plain"))],
        )
        self.assertEqual(result.status_code, 415)

    def test_upload_is_sorted_and_rolls_back_on_invalid_batch(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Upload Test"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "2"}
        ).json()
        uploaded = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[
                ("files", ("b.png", sample_png(200, 300), "image/png")),
                ("files", ("a.png", sample_png(100, 150), "image/png")),
            ],
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.assertEqual(uploaded.json()[0]["width"], 100)
        self.assertEqual(uploaded.json()[1]["width"], 200)

        failed = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[
                ("files", ("c.png", sample_png(), "image/png")),
                ("files", ("d.png", b"broken", "image/png")),
            ],
        )
        self.assertEqual(failed.status_code, 400)
        chapter_after = self.client.get(f"/api/chapters/{chapter['id']}").json()
        self.assertEqual(len(chapter_after["pages"]), 2)

    def test_bulk_import_uses_natural_order_and_detects_duplicates(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Bulk Import"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "1"}
        ).json()
        page_10 = sample_png(210, 310)
        page_2 = sample_png(202, 302)
        page_1 = sample_png(201, 301)
        uploaded = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[
                ("files", ("page_10.png", page_10, "image/png")),
                ("files", ("page_2.png", page_2, "image/png")),
                ("files", ("page_1.png", page_1, "image/png")),
            ],
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.assertEqual(
            [page["original_filename"] for page in uploaded.json()],
            ["page_1.png", "page_2.png", "page_10.png"],
        )

        digest = hashlib.sha256(page_2).hexdigest()
        checked = self.client.post(
            f"/api/chapters/{chapter['id']}/import-check",
            json={"files": [{"name": "copy.png", "content_hash": digest}]},
        )
        self.assertEqual(checked.json()["duplicate_count"], 1)
        self.assertEqual(checked.json()["files"][0]["duplicate_type"], "existing")
        duplicate_upload = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[("files", ("copy.png", page_2, "image/png"))],
        )
        self.assertEqual(duplicate_upload.status_code, 409)

    def test_library_state_returns_to_in_progress_when_new_pages_are_added(self) -> None:
        page_id = self.create_page()
        page = self.client.get(f"/api/pages/{page_id}").json()
        initial = self.client.get("/api/library").json()["items"][0]
        self.assertEqual(initial["library_state"], "unprocessed")

        saved = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{
                "x": 20, "y": 20, "width": 100, "height": 70,
                "original_text": "先輩", "ai_translation": "Tiền bối",
                "final_translation": "Tiền bối",
            }]},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        with database.db_session() as connection:
            connection.execute(
                "UPDATE pages SET clean_image_path = original_image_path WHERE id = ?", (page_id,)
            )
        review = self.client.get("/api/library").json()["items"][0]
        self.assertEqual(review["library_state"], "review")

        approved = self.client.post(
            f"/api/chapters/{page['chapter_id']}/review", json={"approved": True}
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        completed = self.client.get("/api/library").json()["items"][0]
        self.assertEqual(completed["library_state"], "completed")

        new_page = self.client.post(
            f"/api/chapters/{page['chapter_id']}/pages",
            files=[("files", ("new-page.png", sample_png(321, 481), "image/png"))],
        )
        self.assertEqual(new_page.status_code, 201, new_page.text)
        resumed = self.client.get("/api/library").json()["items"][0]
        self.assertEqual(resumed["library_state"], "in_progress")
        self.assertEqual(resumed["state_counts"]["completed"], 1)
        self.assertEqual(resumed["state_counts"]["unprocessed"], 1)

    def test_ocr_job_creates_blocks_and_requires_replace_confirmation(self) -> None:
        class FakeProvider:
            name = "fake-ocr"

            def recognize(self, _image_path: Path) -> list[OcrRegion]:
                return [OcrRegion(10, 20, 100, 60, "こんにちは", 0.92)]

        page_id = self.create_page()
        with patch("app.ocr_service.get_ocr_provider", return_value=FakeProvider()):
            started = self.client.post(
                f"/api/pages/{page_id}/ocr", json={"replace_existing": False}
            )
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result_count"], 1)

        page = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(page["text_blocks"][0]["original_text"], "こんにちは")
        self.assertEqual(page["text_blocks"][0]["ocr_provider"], "fake-ocr")

        protected = self.client.post(
            f"/api/pages/{page_id}/ocr", json={"replace_existing": False}
        )
        self.assertEqual(protected.status_code, 409)

    def test_failed_ocr_job_records_error(self) -> None:
        class FailingProvider:
            name = "failing-ocr"

            def recognize(self, _image_path: Path) -> list[OcrRegion]:
                raise RuntimeError("model failure")

        page_id = self.create_page()
        with patch("app.ocr_service.get_ocr_provider", return_value=FailingProvider()):
            started = self.client.post(
                f"/api/pages/{page_id}/ocr", json={"replace_existing": False}
            )
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error_message"], "model failure")

    def test_full_pipeline_runs_every_stage_in_order(self) -> None:
        page_id = self.create_page()
        order: list[str] = []

        def complete_stage(label: str):
            def run(job_id: int, *_args) -> None:
                order.append(label)
                with database.db_session() as connection:
                    if label == "ocr":
                        now = database.utc_now()
                        page_arg = int(_args[0])
                        connection.execute(
                            """INSERT INTO text_blocks
                               (page_id, x, y, width, height, original_text, created_at, updated_at)
                               VALUES (?, 20, 20, 120, 70, ?, ?, ?)""",
                            (page_arg, "こんにちは", now, now),
                        )
                    elif label == "translation":
                        connection.execute(
                            "UPDATE text_blocks SET ai_translation = 'Xin chào', final_translation = 'Xin chào' WHERE page_id = ?",
                            (int(_args[0]),),
                        )
                    connection.execute(
                        "UPDATE processing_jobs SET status = 'completed', progress = 1 WHERE id = ?",
                        (job_id,),
                    )
            return run

        with (
            patch("app.main.run_ocr_job", side_effect=complete_stage("ocr")),
            patch(
                "app.main.run_bubble_segmentation_job",
                side_effect=complete_stage("bubble_segmentation"),
            ),
            patch("app.main.run_translation_job", side_effect=complete_stage("translation")),
            patch("app.main.run_inpainting_job", side_effect=complete_stage("inpainting")),
            patch("app.main.perform_auto_typeset", return_value=[{"id": 1}]) as typeset,
        ):
            started = self.client.post(
                f"/api/pages/{page_id}/pipeline", json={"replace_existing": False}
            )

        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["current_step"], "Hoàn tất")
        self.assertEqual(job["result_count"], 1)
        self.assertEqual(order, ["ocr", "bubble_segmentation", "translation", "inpainting"])
        typeset.assert_called_once_with(page_id)

    def test_full_pipeline_skips_balloon_model_when_ocr_finds_no_text(self) -> None:
        page_id = self.create_page()

        def complete_empty_ocr(job_id: int, *_args) -> None:
            with database.db_session() as connection:
                connection.execute(
                    "UPDATE processing_jobs SET status = 'completed', progress = 1, result_count = 0 WHERE id = ?",
                    (job_id,),
                )

        with (
            patch("app.main.run_ocr_job", side_effect=complete_empty_ocr),
            patch("app.main.run_bubble_segmentation_job") as bubble_model,
        ):
            started = self.client.post(
                f"/api/pages/{page_id}/pipeline", json={"replace_existing": False}
            )

        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        page = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(page["qa_status"], "warning")
        self.assertEqual(page["qa_issues"][0]["code"], "no_dialogue_or_sfx_review")
        bubble_model.assert_not_called()

    def test_primary_pipeline_keeps_existing_manual_blocks_and_skips_unneeded_stages(self) -> None:
        page_id = self.create_page()
        self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{
                "x": 20, "y": 20, "width": 120, "height": 70,
                "original_text": "風刃脚", "ai_translation": "Phong Nhẫn Cước",
                "final_translation": "Phong Nhẫn Cước", "font_size": 20,
                "content_type": "skill", "text_kind": "sfx",
                "translation_mode": "translate", "render_mode": "preserve",
                "policy_source": "manual",
            }]},
        )

        def complete(job_id: int, *_args) -> None:
            with database.db_session() as connection:
                connection.execute(
                    "UPDATE processing_jobs SET status = 'completed', progress = 1 WHERE id = ?",
                    (job_id,),
                )

        with (
            patch("app.main.run_ocr_job") as ocr,
            patch("app.main.run_bubble_segmentation_job", side_effect=complete),
            patch("app.main.run_translation_job") as translation,
            patch("app.main.run_inpainting_job", side_effect=complete),
            patch("app.main.perform_auto_typeset") as typeset,
        ):
            started = self.client.post(
                f"/api/pages/{page_id}/pipeline", json={"replace_existing": False}
            )

        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed", job)
        ocr.assert_not_called()
        translation.assert_not_called()
        typeset.assert_not_called()
        page = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(page["text_blocks"][0]["original_text"], "風刃脚")
        self.assertEqual(page["text_blocks"][0]["final_translation"], "Phong Nhẫn Cước")

    def test_missing_bubble_is_valid_when_ocr_text_exists(self) -> None:
        page_id = self.create_page()
        self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{
                "x": 20, "y": 20, "width": 120, "height": 70,
                "original_text": "2016年", "ai_translation": "Năm 2016",
                "final_translation": "Năm 2016", "font_size": 20,
            }]},
        )
        rgb = np.full((480, 320, 3), 255, dtype=np.uint8)
        with patch(
            "app.bubble_segmentation_service.extract_bubble_instances",
            return_value=(rgb, [], [], []),
        ):
            started = self.client.post(f"/api/pages/{page_id}/bubble-segmentation")
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["result_count"], 0)
        analysis = self.client.get(f"/api/pages/{page_id}/bubble-analysis").json()
        self.assertEqual(analysis["bubble_count"], 0)
        self.assertIn("tiếp tục dùng vùng OCR", analysis["notice"])

    def test_hybrid_recognizer_prefers_japanese_manga_text(self) -> None:
        self.assertEqual(choose_recognized_text("私は猫です", "Wao ha mao"), "私は猫です")
        self.assertEqual(choose_recognized_text("HELLO", "HELLO"), "HELLO")
        self.assertEqual(choose_recognized_text("", "fallback"), "fallback")

    def test_fallback_tiles_cover_page_edges_with_overlap(self) -> None:
        boxes = tile_boxes(800, 1138, 640, 128)
        self.assertEqual(boxes, [
            (0, 0, 640, 640), (160, 0, 800, 640),
            (0, 498, 640, 1138), (160, 498, 800, 1138),
        ])

    def test_fallback_groups_widely_spaced_vertical_display_text(self) -> None:
        regions = group_fallback_regions([
            DetectedRegion(570, 90, 650, 250, "", 0.4),
            DetectedRegion(505, 500, 795, 710, "", 0.5),
        ])
        self.assertEqual(len(regions), 1)
        self.assertEqual(
            (regions[0].left, regions[0].top, regions[0].right, regions[0].bottom),
            (505, 90, 795, 710),
        )

    def test_manual_crop_ocr_reads_selected_region_without_saving_blocks(self) -> None:
        page_id = self.create_page()
        with patch("app.main.recognize_japanese_crop", return_value="風刃脚") as recognize:
            response = self.client.post(
                f"/api/pages/{page_id}/ocr-crop",
                json={"x": 10, "y": 20, "width": 80, "height": 120},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"], "風刃脚")
        crop = recognize.call_args.args[0]
        self.assertEqual(crop.size, (80, 120))
        page = self.client.get(f"/api/pages/{page_id}").json()
        self.assertEqual(page["text_blocks"], [])

    def test_bubble_analysis_groups_adjacent_text_blocks_by_instance_mask(self) -> None:
        first_mask = np.zeros((120, 160), dtype=bool)
        first_mask[10:70, 10:145] = True
        second_mask = np.zeros((120, 160), dtype=bool)
        second_mask[75:115, 90:155] = True
        blocks = [
            {"id": 1, "x": 20, "y": 20, "width": 35, "height": 30},
            {"id": 2, "x": 85, "y": 25, "width": 40, "height": 30},
            {"id": 3, "x": 105, "y": 82, "width": 30, "height": 25},
            {"id": 4, "x": 1, "y": 80, "width": 20, "height": 20},
        ]
        analysis = analyze_bubble_instances(
            [first_mask, second_mask],
            [(10, 10, 145, 70), (90, 75, 155, 115)],
            [0.96, 0.91],
            blocks,
        )
        self.assertEqual(analysis["bubble_count"], 2)
        self.assertEqual(analysis["multi_text_bubble_count"], 1)
        self.assertEqual(
            [item["text_block_id"] for item in analysis["regions"][0]["text_blocks"]],
            [1, 2],
        )
        self.assertEqual(analysis["unassigned_text_block_ids"], [4])

        preview = render_bubble_preview(
            np.full((120, 160, 3), 255, dtype=np.uint8),
            [first_mask, second_mask],
            analysis,
        )
        self.assertEqual(preview.size, (160, 120))

    def test_bubble_second_pass_recovers_small_japanese_fragment(self) -> None:
        image = Image.new("RGB", (160, 120), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((62, 42, 78, 76), fill="black")
        draw.rectangle((105, 34, 113, 44), fill="black")
        draw.rectangle((104, 53, 114, 64), fill="black")
        mask = np.zeros((120, 160), dtype=bool)
        mask[10:110, 10:150] = True
        blocks = [{
            "id": 9,
            "x": 58,
            "y": 38,
            "width": 25,
            "height": 44,
            "source_x": 58,
            "source_y": 38,
            "source_width": 25,
            "source_height": 44,
            "original_text": "先輩...",
        }]
        analysis = analyze_bubble_instances(
            [mask], [(10, 10, 150, 110)], [0.98], blocks
        )
        recovered = recover_missing_japanese_fragments(
            np.asarray(image), [mask], analysis, blocks,
            recognizer=lambda _crop: "あの先輩...",
        )
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0]["recovered_text"], "あの先輩...")
        self.assertGreater(recovered[0]["source_bbox"][2], 50)

    def test_detector_fragments_are_grouped_by_vertical_flow(self) -> None:
        fragments = [
            DetectedRegion(100, 10, 130, 35, "a", 0.8),
            DetectedRegion(102, 38, 132, 65, "b", 0.6),
            DetectedRegion(250, 10, 290, 45, "c", 0.9),
        ]
        grouped = group_detected_regions(fragments)
        self.assertEqual(len(grouped), 2)
        merged = next(region for region in grouped if region.left < 200)
        self.assertEqual((merged.top, merged.bottom), (10, 65))
        self.assertAlmostEqual(merged.confidence, 0.7)

    def test_comic_detector_keeps_text_classes_and_clamps_boxes(self) -> None:
        regions = detected_regions_from_comic_model(
            boxes=[[-5, 10, 80, 90], [0, 0, 100, 100], [20, 30, 140, 220]],
            labels=[1, 0, 2],
            scores=[0.8, 0.99, 0.7],
            image_width=120,
            image_height=200,
        )
        self.assertEqual(len(regions), 2)
        self.assertEqual((regions[0].left, regions[0].right), (0, 80))
        self.assertEqual((regions[1].right, regions[1].bottom), (120, 200))

    def test_translation_job_maps_results_to_text_blocks(self) -> None:
        class FakeTranslationProvider:
            name = "fake-translation"

            def translate(self, blocks: list[TranslationBlock], _context: dict[str, str]) -> dict[int, str]:
                return {block.id: "Xin chào" for block in blocks}

        page_id = self.create_page()
        saved = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={
                "blocks": [
                    {
                        "x": 20,
                        "y": 30,
                        "width": 120,
                        "height": 80,
                        "original_text": "こんにちは",
                    }
                ]
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        with patch(
            "app.translation_service.get_translation_provider",
            return_value=FakeTranslationProvider(),
        ):
            started = self.client.post(
                f"/api/pages/{page_id}/translate",
                json={"overwrite_existing_ai": False},
            )
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result_count"], 1)
        block = self.client.get(f"/api/pages/{page_id}").json()["text_blocks"][0]
        self.assertEqual(block["ai_translation"], "Xin chào")
        self.assertEqual(block["final_translation"], "Xin chào")

        block["final_translation"] = "Bản tôi đã sửa"
        self.assertEqual(
            self.client.put(
                f"/api/pages/{page_id}/text-blocks", json={"blocks": [block]}
            ).status_code,
            200,
        )

        class SecondFakeProvider:
            name = "fake-translation-2"

            def translate(self, blocks: list[TranslationBlock], _context: dict[str, str]) -> dict[int, str]:
                return {item.id: "Đề xuất mới" for item in blocks}

        with patch(
            "app.translation_service.get_translation_provider",
            return_value=SecondFakeProvider(),
        ):
            rerun = self.client.post(
                f"/api/pages/{page_id}/translate",
                json={"overwrite_existing_ai": True},
            )
        self.assertEqual(rerun.status_code, 202, rerun.text)
        updated = self.client.get(f"/api/pages/{page_id}").json()["text_blocks"][0]
        self.assertEqual(updated["ai_translation"], "Đề xuất mới")
        self.assertEqual(updated["final_translation"], "Bản tôi đã sửa")

    def test_translation_json_requires_exact_block_ids(self) -> None:
        parsed = parse_translation_response(
            '```json\n{"translations":[{"id":7,"text":"Chào bạn"}]}\n```',
            {7},
        )
        self.assertEqual(parsed, {7: "Chào bạn"})
        with self.assertRaises(RuntimeError):
            parse_translation_response('{"translations":[]}', {7})

    def test_translation_json_recovers_mutated_id_for_single_block_only(self) -> None:
        self.assertEqual(
            parse_translation_response(
                '{"translations":[{"id":2224,"text":"Quyền chớp sáng"}]}',
                {2223},
            ),
            {2223: "Quyền chớp sáng"},
        )
        with self.assertRaises(RuntimeError):
            parse_translation_response(
                '{"translations":['
                '{"id":2224,"text":"Câu một"},'
                '{"id":2225,"text":"Câu hai"}'
                ']}',
                {2223, 2226},
            )

    def test_translation_retries_only_missing_ids_and_skips_punctuation(self) -> None:
        calls: list[list[int]] = []

        class PartialProvider:
            name = "partial"

            def translate(self, blocks, _context):
                ids = [block.id for block in blocks]
                calls.append(ids)
                if ids == [1, 2]:
                    raise MissingTranslationsError({2}, {1: "Câu một"})
                return {block.id: f"Câu {block.id}" for block in blocks}

        result = translate_blocks_resilient(
            PartialProvider(),
            [
                TranslationBlock(1, "一"),
                TranslationBlock(2, "二"),
                TranslationBlock(3, "..."),
            ],
            {},
            batch_size=5,
        )
        self.assertEqual(result, {1: "Câu một", 2: "Câu 2", 3: "..."})
        self.assertEqual(calls, [[1, 2], [2]])

    def test_text_mask_and_inpainting_remove_dark_strokes(self) -> None:
        image = Image.new("RGB", (160, 100), "white")
        ImageDraw.Draw(image).text((45, 30), "TEXT", fill="black", stroke_width=1)
        rgb = np.asarray(image)
        boxes = [(35, 20, 80, 50)]
        cleaned, mask = inpaint_text_regions(rgb, boxes)
        self.assertGreater(int(np.count_nonzero(mask)), 0)
        self.assertEqual(int(np.count_nonzero(mask[:, :25])), 0)
        self.assertGreater(float(cleaned[mask > 0].mean()), float(rgb[mask > 0].mean()))

    def test_postcheck_rejects_black_blob_on_light_manga_background(self) -> None:
        original = np.full((120, 140, 3), 235, dtype=np.uint8)
        mask = np.zeros((120, 140), dtype=np.uint8)
        mask[30:90, 50:90] = 255
        candidate = original.copy()
        candidate[mask > 0] = 8
        report = evaluate_inpainting_result(original, candidate, mask, [(35, 15, 70, 90)])
        self.assertFalse(report["acceptable"])
        self.assertTrue(any("mảng đen" in reason for reason in report["reasons"]))

    def test_postcheck_allows_dark_repair_on_dark_background(self) -> None:
        original = np.full((120, 140, 3), 18, dtype=np.uint8)
        mask = np.zeros((120, 140), dtype=np.uint8)
        mask[35:85, 55:85] = 255
        original[mask > 0] = 240  # white Japanese glyph on a black panel
        candidate = original.copy()
        candidate[mask > 0] = 20
        report = evaluate_inpainting_result(original, candidate, mask, [(40, 20, 60, 80)])
        self.assertTrue(report["acceptable"], report)

    def test_sfx_on_complex_background_routes_to_lama_with_aggressive_mask(self) -> None:
        image = Image.new("RGB", (240, 180), "#241d1d")
        draw = ImageDraw.Draw(image)
        draw.rectangle((82, 25, 92, 150), fill="white")
        draw.rectangle((128, 35, 138, 145), fill="white")
        rgb = np.asarray(image)
        generated = np.full_like(rgb, 90)
        with (
            patch("app.inpainting_service.lama_available", return_value=True),
            patch("app.inpainting_service.ctd_available", return_value=False),
            patch("app.inpainting_service.lama_inpaint", return_value=generated) as mocked_lama,
            patch("app.inpainting_service.evaluate_inpainting_result", return_value={
                "acceptable": True, "score": 0.0, "reasons": [],
            }),
        ):
            cleaned, mask, engine = inpaint_text_regions_hybrid(
                rgb,
                [(65, 15, 105, 145)],
                [{"text_kind": "sfx", "sfx_score": 0.9}],
            )
        self.assertEqual(engine, "lama_opencv_qa")
        self.assertGreater(int(np.count_nonzero(mask)), 0)
        mocked_lama.assert_called_once()
        self.assertEqual(cleaned.shape, rgb.shape)

    def test_ctd_mask_is_primary_and_stays_inside_requested_region(self) -> None:
        rgb = np.full((100, 140, 3), 255, dtype=np.uint8)
        learned = np.zeros((100, 140), dtype=np.uint8)
        learned[30:60, 50:70] = 255
        with (
            patch("app.inpainting_service.ctd_available", return_value=True),
            patch("app.inpainting_service.create_ctd_text_mask", return_value=learned),
            patch("app.inpainting_service.create_text_mask") as fallback,
        ):
            mask, engine = create_primary_text_mask(rgb, [(40, 20, 50, 55)])
        self.assertEqual(engine, "ctd")
        self.assertGreater(int(np.count_nonzero(mask[20:75, 40:90])), 0)
        self.assertEqual(int(np.count_nonzero(mask[:, :35])), 0)
        fallback.assert_not_called()

    def test_large_dense_mask_is_rejected_before_inpainting(self) -> None:
        mask = np.zeros((1138, 800), dtype=np.uint8)
        mask[94:708, 506:794] = 255
        with self.assertRaises(UnsafeTextMaskError):
            validate_text_mask_safety(mask, [(506, 94, 288, 614)])

    def test_dense_learned_sfx_mask_is_not_blocked_at_eighty_five_percent(self) -> None:
        mask = np.zeros((200, 200), dtype=np.uint8)
        mask[20:164, 20:120] = 255
        validate_text_mask_safety(mask, [(20, 20, 100, 170)], learned_mask=True)

    def test_large_dense_mask_is_shrunk_for_automatic_lama_fallback(self) -> None:
        mask = np.zeros((1138, 800), dtype=np.uint8)
        # Several thick glyph-like strokes, not one solid rectangle.
        for left in (520, 590, 670, 740):
            mask[110:690, left:left + 38] = 255
        safe, adjusted = shrink_unsafe_text_mask(mask, [(506, 94, 288, 614)])
        self.assertTrue(adjusted)
        original_coverage = float(np.mean(mask[94:708, 506:794] > 0))
        safe_coverage = float(np.mean(safe[94:708, 506:794] > 0))
        self.assertLess(safe_coverage, original_coverage)
        self.assertGreater(int(np.count_nonzero(safe)), 0)
        validate_text_mask_safety(safe, [(506, 94, 288, 614)])

    def test_switching_preserved_sfx_to_replace_invalidates_clean_image(self) -> None:
        page_id = self.create_page()
        saved = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{
                "x": 30, "y": 30, "width": 100, "height": 120,
                "source_x": 30, "source_y": 30,
                "source_width": 100, "source_height": 120,
                "original_text": "閃光拳", "final_translation": "Quyền chớp sáng",
                "text_kind": "sfx", "render_mode": "preserve",
                "policy_source": "manual", "sfx_score": 0.9,
            }]},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        inpainted = self.client.post(f"/api/pages/{page_id}/inpaint")
        self.assertEqual(inpainted.status_code, 202, inpainted.text)
        page = self.client.get(f"/api/pages/{page_id}").json()
        self.assertTrue(page["clean_image_url"])
        block = page["text_blocks"][0]
        block["render_mode"] = "replace"
        changed = self.client.put(
            f"/api/pages/{page_id}/text-blocks", json={"blocks": [block]}
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertTrue(changed.json()["requires_inpainting"])
        refreshed = self.client.get(f"/api/pages/{page_id}").json()
        self.assertTrue(refreshed["needs_inpainting"])
        self.assertEqual(refreshed["clean_image_url"], refreshed["original_image_url"])

    def test_text_mask_keeps_text_touching_image_edge(self) -> None:
        image = Image.new("RGB", (140, 100), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((42, 0, 49, 30), fill="black")
        draw.rectangle((55, 2, 62, 32), fill="black")
        mask = create_text_mask(np.asarray(image), [(38, 0, 35, 38)])
        self.assertGreater(int(np.count_nonzero(mask[:35, 40:65])), 0)

    def test_inpainting_job_creates_clean_image(self) -> None:
        manga = self.client.post("/api/manga", json={"title": "Clean Test"}).json()
        chapter = self.client.post(
            f"/api/manga/{manga['id']}/chapters", json={"chapter_number": "1"}
        ).json()
        page = self.client.post(
            f"/api/chapters/{chapter['id']}/pages",
            files=[("files", ("text.png", sample_text_png(), "image/png"))],
        ).json()[0]
        self.client.put(
            f"/api/pages/{page['id']}/text-blocks",
            json={
                "blocks": [
                    {
                        "x": 30,
                        "y": 25,
                        "width": 100,
                        "height": 60,
                        "original_text": "テスト",
                    }
                ]
            },
        )
        started = self.client.post(f"/api/pages/{page['id']}/inpaint")
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed", job)
        updated = self.client.get(f"/api/pages/{page['id']}").json()
        self.assertTrue(updated["clean_image_path"].endswith(".png"))
        self.assertTrue(updated["mask_preview_path"].endswith(".png"))
        self.assertTrue(updated["mask_preview_url"].startswith("/uploads/"))
        self.assertTrue((main.UPLOAD_DIR / updated["clean_image_path"]).is_file())
        self.assertTrue((main.UPLOAD_DIR / updated["mask_preview_path"]).is_file())

    def test_mask_protects_long_decorative_line_near_text(self) -> None:
        image = Image.new("RGB", (220, 140), "white")
        draw = ImageDraw.Draw(image)
        draw.line((55, 15, 55, 125), fill="black", width=4)
        draw.text((85, 55), "TEXT", fill="black", stroke_width=1)
        mask = create_text_mask(np.asarray(image), [(75, 45, 80, 45)])
        self.assertGreater(int(np.count_nonzero(mask)), 0)
        self.assertEqual(int(np.count_nonzero(mask[:, 53:58])), 0)

    def test_mask_protects_panel_edge_but_not_internal_vertical_text_stroke(self) -> None:
        image = Image.new("RGB", (240, 180), "white")
        draw = ImageDraw.Draw(image)
        draw.line((55, 0, 55, 179), fill="black", width=4)
        draw.line((130, 42, 130, 137), fill="black", width=4)
        mask = create_text_mask(np.asarray(image), [(40, 30, 125, 120)])
        self.assertEqual(int(np.count_nonzero(mask[:, 53:58])), 0)
        self.assertGreater(int(np.count_nonzero(mask[40:140, 127:134])), 0)

    def test_mask_protects_curved_balloon_outline_around_text(self) -> None:
        image = Image.new("RGB", (220, 160), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((20, 10, 200, 150), outline="black", width=4)
        draw.rectangle((100, 45, 108, 72), fill="black")
        draw.rectangle((100, 83, 108, 112), fill="black")
        mask = create_text_mask(np.asarray(image), [(25, 15, 170, 130)])
        self.assertGreater(int(np.count_nonzero(mask[40:118, 95:114])), 0)
        self.assertEqual(int(np.count_nonzero(mask[8:18, 90:130])), 0)

    def test_text_layout_fits_long_vietnamese_inside_block(self) -> None:
        layout = fit_text_layout(
            "Đây là một câu tiếng Việt khá dài cần được tự động xuống dòng.",
            width=180,
            height=100,
        )
        self.assertGreaterEqual(layout.font_size, 6)
        self.assertLessEqual(layout.width, 162)
        self.assertLessEqual(layout.height, 90)
        self.assertGreater(len(layout.lines), 1)

    def test_text_layout_keeps_safe_margin_and_splits_oversized_token(self) -> None:
        layout = fit_text_layout(
            "MotTuRatDaiKhongCoKhoangTrangDeKiemTraKhongBiTran",
            width=120,
            height=90,
        )
        self.assertLessEqual(layout.width, round(120 * 0.78))
        self.assertLessEqual(layout.height, round(90 * 0.82))
        self.assertGreater(len(layout.lines), 1)

    def test_text_layout_shrinks_instead_of_splitting_a_normal_word(self) -> None:
        layout = fit_text_layout(
            "Chính ta rồi! Vaccine Man!",
            width=143,
            height=382,
        )
        self.assertIn("Vaccine", layout.lines)
        self.assertNotIn("Vaccin", layout.lines)
        self.assertNotIn("e", layout.lines)
        self.assertLessEqual(layout.width, round(143 * 0.78))

    def test_text_layout_normalizes_fullwidth_punctuation_for_latin_font(self) -> None:
        layout = fit_text_layout("．．．！？", width=80, height=80)
        self.assertEqual("".join(layout.lines), "...!?")

    def test_grouped_dialogue_uses_original_vertical_order_without_overlap(self) -> None:
        cells = partition_text_regions_by_source(
            (52.33, 714.59, 185.27, 379.92),
            [
                {"id": 1, "x": 121.1, "y": 722.35, "width": 108.1, "height": 166.84},
                {"id": 2, "x": 66.29, "y": 897.01, "width": 104.77, "height": 186.95},
            ],
        )
        upper = cells[1]
        lower = cells[2]
        self.assertLessEqual(upper[1] + upper[3], lower[1])
        self.assertLess(upper[1], lower[1])
        self.assertGreater(upper[2], 150)
        self.assertGreater(lower[2], 150)

    def test_typesetting_reconnects_bubble_after_block_ids_change(self) -> None:
        region = {
            "index": 1,
            "bbox": [308.22, 712.53, 177.08, 222.58],
            "text_blocks": [{"text_block_id": 10}, {"text_block_id": 11}],
        }
        current_rows = [
            {"id": 110, "x": 0, "y": 0, "width": 1, "height": 1,
             "source_x": 322.23, "source_y": 720.98,
             "source_width": 105.33, "source_height": 203.85},
            {"id": 111, "x": 0, "y": 0, "width": 1, "height": 1,
             "source_x": 439.77, "source_y": 727.30,
             "source_width": 38.75, "source_height": 77.23},
        ]
        mapped = main._map_blocks_to_bubble_regions(current_rows, [region])
        self.assertIs(mapped[110], region)
        self.assertIs(mapped[111], region)

    def test_grouped_cell_is_constrained_inside_curved_bubble(self) -> None:
        image = Image.new("RGB", (220, 220), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((30, 10, 190, 210), outline="black", width=5)
        constrained = constrain_cell_to_bubble_interior(
            image,
            (25, 5, 170, 210),
            (34, 16, 152, 90),
        )
        self.assertGreater(constrained[0], 34)
        self.assertLess(constrained[2], 152)
        self.assertEqual(constrained[1], 16)
        self.assertEqual(constrained[3], 90)

    def test_grouped_cell_prefers_saved_segmentation_spans(self) -> None:
        region = {
            "bbox": [50, 10, 150, 190],
            "safe_row_spans": [[row, 92, 178] for row in range(20, 105)],
        }
        constrained = constrain_cell_to_bubble_interior(
            Image.new("RGB", (240, 220), "white"),
            region,
            (60, 20, 130, 80),
        )
        self.assertEqual(constrained, (92.0, 20, 86.0, 80))

    def test_bubble_mask_is_compacted_to_safe_spans(self) -> None:
        mask = np.zeros((120, 140), dtype=bool)
        mask[10:110, 20:120] = True
        spans = safe_row_spans(mask, (20, 10, 100, 100))
        self.assertGreater(len(spans), 70)
        middle = spans[len(spans) // 2]
        self.assertGreater(middle[1], 20)
        self.assertLess(middle[2], 120)

    def test_vertical_japanese_columns_become_vietnamese_top_to_bottom(self) -> None:
        cells = partition_text_regions_by_source(
            (531.85, 27.15, 182.03, 286.86),
            [
                {"id": 1, "x": 549.41, "y": 61.81, "width": 113.71, "height": 228.47,
                 "final_translation": "Đưa đồng đội vào tay kẻ địch rồi còn để chúng tẩu thoát?"},
                {"id": 2, "x": 675.95, "y": 53.04, "width": 31.56, "height": 86.84,
                 "final_translation": "..."},
            ],
        )
        long_left_column = cells[1]
        short_right_column = cells[2]
        self.assertGreater(
            short_right_column[0], long_left_column[0] + long_left_column[2]
        )
        self.assertLess(short_right_column[1], 70)
        self.assertGreater(long_left_column[3], short_right_column[3] * 2)

    def test_two_lobe_bubble_uses_source_gap_as_vertical_boundary(self) -> None:
        cells = partition_text_regions_by_source(
            (51.04, 602.92, 200.59, 416.39),
            [
                {
                    "id": 1, "x": 126.65, "y": 599.86,
                    "width": 102.03, "height": 194.35,
                    "final_translation": "Nếu không làm được thì chẳng còn gì để nói cả",
                },
                {
                    "id": 2, "x": 73.83, "y": 801.33,
                    "width": 111.21, "height": 203.25,
                    "final_translation": "Ta là âm đạo Sonic đó",
                },
            ],
        )
        upper, lower = cells[1], cells[2]
        boundary = (upper[1] + upper[3] + lower[1]) / 2
        self.assertAlmostEqual(boundary, 799.2, delta=6)
        self.assertLessEqual(upper[1] + upper[3], lower[1])
        self.assertGreater(lower[3], 180)

    def test_typesetting_moves_text_away_from_character_art(self) -> None:
        image = Image.new("RGB", (200, 140), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((65, 76, 135, 125), fill="black")
        layout, offset_y, _ = fit_text_away_from_art(
            image, "Xin chào bạn", x=40, y=20, width=120, height=105
        )
        self.assertGreaterEqual(layout.font_size, 10)
        self.assertLess(offset_y, -5)

    def test_typesetting_moves_whole_box_into_clear_space_above(self) -> None:
        image = Image.new("RGB", (240, 200), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((75, 95, 165, 170), fill="black")
        layout, placed_x, placed_y, score = place_text_in_clear_area(
            image, "Chờ làm chi nữa?", anchor_x=60, anchor_y=75,
            width=120, height=90,
        )
        self.assertGreaterEqual(layout.font_size, 10)
        self.assertGreaterEqual(placed_x, 0)
        self.assertLess(placed_y, 75)
        self.assertLessEqual(score, 0.075)

    def test_typesetting_keeps_clearance_from_panel_border(self) -> None:
        image = Image.new("RGB", (260, 220), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((80, 110, 185, 205), fill="black")
        draw.line((218, 0, 218, 219), fill="black", width=4)
        _, placed_x, placed_y, _ = place_text_in_clear_area(
            image, "Chờ làm chi nữa?", anchor_x=90, anchor_y=85,
            width=120, height=95,
        )
        self.assertLessEqual(placed_x, 90)
        self.assertLess(placed_y, 85)

    def test_typesetting_prefers_optical_center_of_negative_space(self) -> None:
        image = Image.new("RGB", (300, 220), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 280, 200), outline="black", width=4)
        draw.rectangle((105, 135, 235, 196), fill="black")
        _, placed_x, placed_y, _ = place_text_in_clear_area(
            image, "Tiếp theo là cú sút ngắn nhé?",
            anchor_x=190, anchor_y=45, width=82, height=90,
        )
        self.assertLess(placed_x, 180)
        self.assertLessEqual(placed_y, 55)

    def test_typesetting_does_not_cross_panel_edge_into_page_gutter(self) -> None:
        image = Image.new("RGB", (220, 180), "white")
        draw = ImageDraw.Draw(image)
        draw.line((55, 0, 55, 179), fill="black", width=4)
        draw.rectangle((90, 120, 180, 175), fill="black")
        _, placed_x, _, _ = place_text_in_clear_area(
            image, "Anh trai ơi...", anchor_x=25, anchor_y=45,
            width=90, height=80,
        )
        self.assertGreaterEqual(placed_x, 52)

    def test_typesetting_keeps_gap_between_grouped_dialogues(self) -> None:
        image = Image.new("RGB", (340, 180), "white")
        container = (30.0, 20.0, 310.0, 160.0)
        right_layout, right_x, right_y, _ = place_text_in_clear_area(
            image, "Cái bóng thì sao?", anchor_x=185, anchor_y=35,
            width=100, height=100, container_bounds=container,
        )
        right_box = text_layout_bounds(right_layout, right_x, right_y, 100, 100)
        left_layout, left_x, left_y, _ = place_text_in_clear_area(
            image, "Đừng có lải nhải nữa!", anchor_x=75, anchor_y=35,
            width=110, height=100, occupied_boxes=(right_box,),
            occupied_clearance=16, container_bounds=container,
        )
        left_box = text_layout_bounds(left_layout, left_x, left_y, 110, 100)
        horizontal_overlap = max(
            0.0,
            min(left_box[0] + left_box[2], right_box[0] + right_box[2] + 16)
            - max(left_box[0], right_box[0] - 16),
        )
        vertical_overlap = max(
            0.0,
            min(left_box[1] + left_box[3], right_box[1] + right_box[3] + 16)
            - max(left_box[1], right_box[1] - 16),
        )
        self.assertTrue(horizontal_overlap == 0 or vertical_overlap == 0)

    def test_grouped_fallback_shrinks_text_to_preserve_gap(self) -> None:
        container = (10.0, 10.0, 330.0, 170.0)
        occupied = ((205.0, 45.0, 90.0, 105.0),)
        layout, placed_x, placed_y = pack_grouped_text_fallback(
            "Đừng chần chừ nữa!",
            anchor_x=145,
            anchor_y=40,
            width=120,
            height=110,
            occupied_boxes=occupied,
            clearance=16,
            container_bounds=container,
        )
        box = text_layout_bounds(layout, placed_x, placed_y, 120, 110)
        self.assertLessEqual(box[0] + box[2], occupied[0][0] - 16 + 0.5)
        self.assertGreaterEqual(layout.font_size, 10)

    def test_typeset_and_export_render_translated_png(self) -> None:
        page_id = self.create_page()
        saved = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={
                "blocks": [
                    {
                        "x": 40,
                        "y": 50,
                        "width": 160,
                        "height": 100,
                        "original_text": "こんにちは",
                        "ai_translation": "Xin chào, rất vui được gặp bạn!",
                        "final_translation": "Xin chào, rất vui được gặp bạn!",
                        "font_size": 100,
                    }
                ]
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        typeset = self.client.post(f"/api/pages/{page_id}/typeset")
        self.assertEqual(typeset.status_code, 200, typeset.text)
        self.assertLess(typeset.json()["blocks"][0]["font_size"], 100)

        exported = self.client.get(f"/api/pages/{page_id}/export.png")
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(exported.headers["content-type"], "image/png")
        image = Image.open(io.BytesIO(exported.content)).convert("RGB")
        self.assertEqual(image.size, (320, 480))
        self.assertLess(float(np.asarray(image).mean()), 255)

    def test_complex_free_standing_text_is_preserved_but_bubble_text_is_replaced(self) -> None:
        image = np.zeros((480, 320, 3), dtype=np.uint8)
        for y in range(0, 480, 5):
            image[y:y + 2, :, :] = 255
        blocks = [{
            "id": 1, "x": 35, "y": 70, "width": 150, "height": 300,
            "source_x": 35, "source_y": 70, "source_width": 150, "source_height": 300,
            "original_text": "閃光拳",
        }]
        free_policy = classify_text_policies(image, {"regions": []}, blocks)[1]
        self.assertEqual(free_policy["render_mode"], "preserve")
        bubble_policy = classify_text_policies(
            np.full_like(image, 255),
            {"regions": [{"text_blocks": [{"text_block_id": 1}]}]},
            blocks,
        )[1]
        self.assertEqual(bubble_policy["render_mode"], "replace")

    def test_preserved_sfx_is_not_erased_or_rendered_and_passes_residual_qa(self) -> None:
        page_id = self.create_page()
        saved = self.client.put(
            f"/api/pages/{page_id}/text-blocks",
            json={"blocks": [{
                "x": 30, "y": 60, "width": 180, "height": 260,
                "original_text": "閃光拳", "ai_translation": "Quyền chớp sáng",
                "final_translation": "Quyền chớp sáng", "font_size": 32,
                "text_kind": "sfx", "render_mode": "preserve",
                "policy_source": "manual", "sfx_score": 0.95,
            }]},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        started = self.client.post(f"/api/pages/{page_id}/inpaint")
        self.assertEqual(started.status_code, 202, started.text)
        job = self.client.get(f"/api/jobs/{started.json()['job_id']}").json()
        self.assertEqual(job["status"], "completed", job)
        checked = self.client.post(f"/api/pages/{page_id}/quality-check").json()
        self.assertEqual(checked["status"], "pass", checked)
        exported = self.client.get(f"/api/pages/{page_id}/export.png")
        image = Image.open(io.BytesIO(exported.content)).convert("RGB")
        self.assertEqual(float(np.asarray(image).mean()), 255.0)


if __name__ == "__main__":
    unittest.main()
