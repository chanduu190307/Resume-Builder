"""The common line model all extractors produce."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Segment:
    """A run of text on a line, separated from neighbours by a large gap or a tab.

    In "Senior Engineer        Mar 2021 - Present" the title and the date are two
    segments. Plain text has no positions, so tabs or 3+ spaces mark segments.
    """

    text: str
    bold: bool = False
    italic: bool = False


@dataclass
class Line:
    segments: list[Segment]
    page: int = 1
    bullet: bool = False
    """True if the line started with a list marker or is a Word list item."""
    x0: float | None = None
    """Left edge in points (PDF only); used to recognise wrapped bullet text."""
    size: float | None = None
    """Dominant font size in points (PDF/DOCX), if known."""
    column: int = 0
    """0 for single-column pages; 0/1 for left/right column in two-column layouts."""
    source_index: int = field(default=0)
    """Position in the original reading order (for fidelity reporting)."""

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segments if s.text).strip()

    @property
    def bold(self) -> bool:
        parts = [s for s in self.segments if s.text.strip()]
        return bool(parts) and all(s.bold for s in parts)

    @property
    def italic(self) -> bool:
        parts = [s for s in self.segments if s.text.strip()]
        return bool(parts) and all(s.italic for s in parts)

    def __repr__(self) -> str:  # compact debugging output
        flags = "".join(f for f, on in (("B", self.bold), ("I", self.italic), ("*", self.bullet)) if on)
        segs = " | ".join(s.text for s in self.segments)
        return f"Line(p{self.page}{'/c' + str(self.column) if self.column else ''} {flags} {segs!r})"
