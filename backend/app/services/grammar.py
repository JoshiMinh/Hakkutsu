import json
import logging
import re
from pathlib import Path
from typing import List, Dict

from app.models.analysis import GrammarPattern

logger = logging.getLogger(__name__)

class GrammarService:
    """Grammar pattern recognition service."""

    def __init__(self):
        self._patterns: List[Dict] = []
        self._loaded = False
        self._grammar_file_path = Path("app/data/grammar/grammar.json")

    def _load(self):
        if self._loaded:
            return

        if not self._grammar_file_path.exists():
            logger.warning(
                "Grammar data file not found at %s. "
                "Grammar recognition will return empty results.",
                self._grammar_file_path,
            )
            self._loaded = True
            return

        try:
            with open(self._grammar_file_path, "r", encoding="utf-8") as f:
                self._patterns = json.load(f)
            logger.info("Loaded %d grammar patterns", len(self._patterns))
            self._loaded = True
        except Exception as e:
            logger.error("Failed to load grammar patterns: %s", e)
            self._loaded = True

    def find_patterns(self, text: str) -> List[GrammarPattern]:
        """
        Scan the text for known grammar patterns using regular expressions.
        """
        self._load()
        results = []

        for p in self._patterns:
            regex_pattern = p.get("regex", "")
            if regex_pattern:
                if re.search(regex_pattern, text):
                    results.append(
                        GrammarPattern(
                            pattern=p.get("pattern", ""),
                            meaning=p.get("meaning", ""),
                            explanation=p.get("explanation", ""),
                            jlpt_level=p.get("jlpt_level", "")
                        )
                    )
        return results

# Singleton instance
grammar_service = GrammarService()
