"""
Japanese tokenizer service using SudachiPy.

Wraps Sudachi's morphological analyzer to produce token analysis
with surface forms, dictionary forms, readings, and POS tags.
"""

import logging
from typing import List

from app.models.analysis import TokenAnalysis, TokenReading

logger = logging.getLogger(__name__)

# Japanese Unicode ranges for detection
HIRAGANA_RANGE = (0x3040, 0x309F)
KATAKANA_RANGE = (0x30A0, 0x30FF)
CJK_RANGE = (0x4E00, 0x9FFF)
CJK_EXT_A = (0x3400, 0x4DBF)
FULLWIDTH_RANGE = (0xFF00, 0xFFEF)


def _is_japanese_char(char: str) -> bool:
    """Check if a single character is Japanese (hiragana, katakana, or kanji)."""
    code = ord(char)
    return (
        HIRAGANA_RANGE[0] <= code <= HIRAGANA_RANGE[1]
        or KATAKANA_RANGE[0] <= code <= KATAKANA_RANGE[1]
        or CJK_RANGE[0] <= code <= CJK_RANGE[1]
        or CJK_EXT_A[0] <= code <= CJK_EXT_A[1]
    )


def _is_japanese_text(text: str) -> bool:
    """Check if text contains any Japanese characters."""
    return any(_is_japanese_char(c) for c in text)


def _katakana_to_hiragana(text: str) -> str:
    """Convert katakana characters to hiragana."""
    result = []
    for char in text:
        code = ord(char)
        if KATAKANA_RANGE[0] <= code <= KATAKANA_RANGE[1]:
            # Katakana to hiragana offset is 0x60
            result.append(chr(code - 0x60))
        else:
            result.append(char)
    return "".join(result)


class TokenizerService:
    """Japanese morphological analysis service."""

    def __init__(self):
        self._tokenizer = None
        self._mode = None

    def _get_tokenizer(self):
        """Lazy-load Sudachi tokenizer."""
        if self._tokenizer is None:
            try:
                from sudachipy import Dictionary, SplitMode

                dict_instance = Dictionary()
                self._tokenizer = dict_instance.create()

                from app.core.config import settings

                mode_map = {
                    "A": SplitMode.A,
                    "B": SplitMode.B,
                    "C": SplitMode.C,
                }
                self._mode = mode_map.get(settings.SUDACHI_MODE, SplitMode.C)
                logger.info("Sudachi tokenizer initialized (mode=%s)", settings.SUDACHI_MODE)
            except ImportError:
                logger.warning(
                    "SudachiPy not installed. Using fallback character-level tokenizer."
                )
                self._tokenizer = "fallback"

        return self._tokenizer

    def tokenize(self, text: str) -> List[TokenAnalysis]:
        """
        Tokenize Japanese text and return analysis for each token.

        Falls back to character-level splitting if Sudachi is not available.
        """
        tokenizer = self._get_tokenizer()

        if tokenizer == "fallback":
            return self._fallback_tokenize(text)

        return self._sudachi_tokenize(text)

    def _sudachi_tokenize(self, text: str) -> List[TokenAnalysis]:
        """Tokenize using SudachiPy."""
        from sudachipy import SplitMode

        morphemes = self._tokenizer.tokenize(text, self._mode)
        tokens = []

        for morpheme in morphemes:
            surface = morpheme.surface()
            reading_form = morpheme.reading_form()
            dict_form = morpheme.dictionary_form()
            pos = morpheme.part_of_speech()

            # Build reading
            hiragana = _katakana_to_hiragana(reading_form) if reading_form else surface
            is_jp = _is_japanese_text(surface)

            token = TokenAnalysis(
                surface=surface,
                dictionary_form=dict_form if dict_form else surface,
                reading=TokenReading(hiragana=hiragana),
                pos=pos[0] if pos else "unknown",
                pos_detail=list(pos) if pos else [],
                is_japanese=is_jp,
            )
            tokens.append(token)

        return tokens

    def _fallback_tokenize(self, text: str) -> List[TokenAnalysis]:
        """
        Simple fallback tokenizer that splits on character type boundaries.
        Used when Sudachi is not installed.
        """
        tokens = []
        current = ""
        current_type = None

        for char in text:
            char_type = self._get_char_type(char)

            if char_type != current_type and current:
                tokens.append(self._make_fallback_token(current))
                current = ""

            current += char
            current_type = char_type

        if current:
            tokens.append(self._make_fallback_token(current))

        return tokens

    def _get_char_type(self, char: str) -> str:
        """Classify a character by type."""
        code = ord(char)
        if HIRAGANA_RANGE[0] <= code <= HIRAGANA_RANGE[1]:
            return "hiragana"
        if KATAKANA_RANGE[0] <= code <= KATAKANA_RANGE[1]:
            return "katakana"
        if CJK_RANGE[0] <= code <= CJK_RANGE[1] or CJK_EXT_A[0] <= code <= CJK_EXT_A[1]:
            return "kanji"
        if char.isascii() and char.isalpha():
            return "ascii"
        if char.isdigit():
            return "digit"
        return "other"

    def _make_fallback_token(self, text: str) -> TokenAnalysis:
        """Create a basic TokenAnalysis from raw text."""
        is_jp = _is_japanese_text(text)
        return TokenAnalysis(
            surface=text,
            dictionary_form=text,
            reading=TokenReading(hiragana=text),
            pos="unknown",
            pos_detail=[],
            is_japanese=is_jp,
        )


# Singleton instance
tokenizer_service = TokenizerService()
