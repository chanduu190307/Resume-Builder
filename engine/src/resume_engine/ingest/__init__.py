"""Document ingestion: PDF / DOCX / TXT / pasted text -> normalised lines.

Every input format is converted to the same ``Line`` structure so the parser
behaves identically regardless of how the resume arrived.
"""

from .lines import Line, Segment
from .normalize import normalize_lines, normalize_text
from .sniff import FileKind, UnsupportedFile, sniff_kind

__all__ = ["FileKind", "Line", "Segment", "UnsupportedFile", "normalize_lines", "normalize_text", "sniff_kind"]
