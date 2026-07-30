"""Training and inference pipeline for DocDeco document intelligence."""

from .labels import LABELS, DetailedRole, style_role_for
from .records import ParagraphRecord

__all__ = ["LABELS", "DetailedRole", "ParagraphRecord", "style_role_for"]

