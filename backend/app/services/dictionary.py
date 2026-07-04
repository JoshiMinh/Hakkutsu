"""
JMdict dictionary lookup service.

Loads JMdict-simplified JSON and provides word lookups
returning definitions, readings, and part-of-speech information.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from app.models.analysis import DictionaryEntry
from app.core.config import settings

logger = logging.getLogger(__name__)


class DictionaryService:
    """JMdict dictionary lookup service."""

    def __init__(self):
        self._entries: Dict[str, List[dict]] = {}
        self._reading_index: Dict[str, List[str]] = {}
        self._loaded = False

    def _load(self):
        """Load JMdict-simplified JSON data."""
        if self._loaded:
            return

        jmdict_path = Path(settings.JMDICT_PATH)
        if not jmdict_path.exists():
            logger.warning(
                "JMdict data file not found at %s. "
                "Dictionary lookups will return empty results. "
                "Download from: https://github.com/scriptin/jmdict-simplified/releases",
                jmdict_path,
            )
            self._loaded = True
            return

        try:
            logger.info("Loading JMdict data from %s...", jmdict_path)
            with open(jmdict_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Index entries by kanji and reading forms
            words = data.get("words", [])
            for entry in words:
                # Index by kanji forms
                for kanji in entry.get("kanji", []):
                    text = kanji.get("text", "")
                    if text:
                        if text not in self._entries:
                            self._entries[text] = []
                        self._entries[text].append(entry)

                # Index by reading forms
                for kana in entry.get("kana", []):
                    text = kana.get("text", "")
                    if text:
                        if text not in self._entries:
                            self._entries[text] = []
                        self._entries[text].append(entry)

            logger.info("Loaded %d JMdict entries", len(self._entries))
            self._loaded = True

        except Exception as e:
            logger.error("Failed to load JMdict data: %s", e)
            self._loaded = True

    def lookup(self, word: str) -> List[DictionaryEntry]:
        """
        Look up a word in JMdict.

        Args:
            word: Japanese word (kanji or kana form)

        Returns:
            List of dictionary entries with glosses and POS.
        """
        self._load()

        entries = self._entries.get(word, [])
        results = []

        for entry in entries[:5]:  # Limit to top 5 entries
            senses = entry.get("sense", [])
            for sense in senses[:3]:  # Limit to top 3 senses per entry
                glosses = []
                for gloss in sense.get("gloss", []):
                    if gloss.get("lang", "eng") == "eng":
                        glosses.append(gloss.get("text", ""))

                pos_tags = sense.get("partOfSpeech", [])
                misc = sense.get("misc", [])
                field = sense.get("field", [])

                if glosses:
                    results.append(
                        DictionaryEntry(
                            glosses=glosses,
                            pos=pos_tags,
                            field=field[0] if field else None,
                            misc=misc,
                        )
                    )

        return results

    def search(self, query: str, limit: int = 10) -> Dict[str, List[DictionaryEntry]]:
        """
        Search for words matching a query prefix.

        Returns a dict mapping matched words to their definitions.
        """
        self._load()

        results = {}
        count = 0

        for key, entries in self._entries.items():
            if key.startswith(query) and count < limit:
                results[key] = self.lookup(key)
                count += 1

        return results


# Singleton instance
dictionary_service = DictionaryService()
