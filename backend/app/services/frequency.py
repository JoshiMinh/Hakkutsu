"""
Word frequency and JLPT level service.

Provides word frequency rankings and JLPT level assignments
using curated word lists.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# Built-in JLPT word samples (subset for MVP — full lists loaded from files)
# These are common words to provide basic JLPT tagging without external data
JLPT_SAMPLE: Dict[str, str] = {
    # N5 — most basic
    "私": "N5", "食べる": "N5", "飲む": "N5", "行く": "N5", "来る": "N5",
    "見る": "N5", "聞く": "N5", "読む": "N5", "書く": "N5", "話す": "N5",
    "大きい": "N5", "小さい": "N5", "新しい": "N5", "古い": "N5", "良い": "N5",
    "日本": "N5", "人": "N5", "時": "N5", "年": "N5", "月": "N5",
    "日": "N5", "今": "N5", "何": "N5", "学校": "N5", "先生": "N5",
    "学生": "N5", "友達": "N5", "家": "N5", "水": "N5", "電車": "N5",
    "する": "N5", "なる": "N5", "ある": "N5", "いる": "N5", "言う": "N5",
    "思う": "N5", "知る": "N5", "出る": "N5", "入る": "N5", "使う": "N5",
    # N4
    "経験": "N4", "社会": "N4", "特別": "N4", "普通": "N4", "最近": "N4",
    "趣味": "N4", "文化": "N4", "準備": "N4", "説明": "N4", "注意": "N4",
    "届ける": "N4", "届く": "N4", "集める": "N4", "伝える": "N4", "決める": "N4",
    "変わる": "N4", "比べる": "N4", "育てる": "N4", "慣れる": "N4", "間に合う": "N4",
    # N3
    "環境": "N3", "影響": "N3", "技術": "N3", "情報": "N3", "政治": "N3",
    "経済": "N3", "制度": "N3", "状況": "N3", "条件": "N3", "対象": "N3",
    "存在": "N3", "現象": "N3", "表現": "N3", "印象": "N3", "判断": "N3",
    "実現": "N3", "発展": "N3", "維持": "N3", "確認": "N3", "提供": "N3",
    # N2
    "概念": "N2", "傾向": "N2", "構造": "N2", "要素": "N2", "分析": "N2",
    "観点": "N2", "根拠": "N2", "妥当": "N2", "抽象": "N2", "具体": "N2",
    "把握": "N2", "促進": "N2", "蓄積": "N2", "削減": "N2", "措置": "N2",
    # N1
    "顕著": "N1", "網羅": "N1", "逸脱": "N1", "瓦解": "N1", "齟齬": "N1",
    "忖度": "N1", "僥倖": "N1", "邂逅": "N1", "慟哭": "N1", "蹂躙": "N1",
}


class FrequencyService:
    """Word frequency ranking and JLPT level service."""

    def __init__(self):
        self._jlpt_data: Dict[str, str] = {}
        self._frequency_data: Dict[str, int] = {}
        self._loaded = False

    def _load(self):
        """Load JLPT and frequency data from files."""
        if self._loaded:
            return

        # Start with built-in sample data
        self._jlpt_data = dict(JLPT_SAMPLE)

        # Try to load full JLPT word lists from data directory
        jlpt_dir = Path(settings.JLPT_DATA_PATH)
        if jlpt_dir.exists():
            for level in ["N5", "N4", "N3", "N2", "N1"]:
                level_file = jlpt_dir / f"{level.lower()}.json"
                if level_file.exists():
                    try:
                        with open(level_file, "r", encoding="utf-8") as f:
                            words = json.load(f)
                        for word in words:
                            self._jlpt_data[word] = level
                        logger.info("Loaded %d %s words", len(words), level)
                    except Exception as e:
                        logger.warning("Failed to load %s data: %s", level, e)
        else:
            logger.info(
                "JLPT data directory not found at %s. Using built-in sample data.",
                jlpt_dir,
            )

        # Try to load frequency data
        freq_dir = Path(settings.FREQUENCY_DATA_PATH)
        if freq_dir.exists():
            freq_file = freq_dir / "frequency.json"
            if freq_file.exists():
                try:
                    with open(freq_file, "r", encoding="utf-8") as f:
                        self._frequency_data = json.load(f)
                    logger.info("Loaded %d frequency entries", len(self._frequency_data))
                except Exception as e:
                    logger.warning("Failed to load frequency data: %s", e)

        self._loaded = True

    def get_jlpt_level(self, word: str) -> Optional[str]:
        """
        Get the JLPT level for a word.

        Returns: "N5", "N4", "N3", "N2", "N1", or None
        """
        self._load()
        return self._jlpt_data.get(word)

    def get_frequency_rank(self, word: str) -> Optional[int]:
        """
        Get the frequency rank for a word.

        Returns: Integer rank (1 = most common) or None.
        """
        self._load()
        return self._frequency_data.get(word)


# Singleton instance
frequency_service = FrequencyService()
