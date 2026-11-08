"""Text normalisation shared by every input format.

Goal: the same resume yields the same lines whether it came from a PDF, a DOCX,
a text file or the clipboard. Normalisation only changes *representation*
(Unicode forms, invisible characters, bullet glyphs, whitespace, repeated page
furniture), never wording. Wrapped lines are joined later by the parser.
"""

from __future__ import annotations

import re
import unicodedata

from .lines import Line, Segment

# Invisible or layout-only characters that extractors leak into text.
_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff\u00ad"), None)
_SPACES = re.compile("[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]+")

# Glyphs used as list markers, including private-use symbols from Word/Symbol fonts.
BULLET_CHARS = "•●▪■◦○◆◇►▸▹➢➤✓✔∙·⁃–—*\u2023\uf0b7\uf0a7\uf076\uf0d8\uf0fc-"
# Letter markers ("a) ") are not recognised: they collide with initials ("K. Watanabe").
_BULLET_RE = re.compile(rf"^\s*(?:[{re.escape(BULLET_CHARS)}]|\d{{1,2}}[.)])\s+")
# A marker glued to the text ("•Led a team") for the unambiguous glyphs only.
_GLUED_BULLET_RE = re.compile("^\\s*[•●▪■◦○◆►▸➢➤✓✔∙\uf0b7\uf0a7\uf076\uf0d8\uf0fc]\\s*")

_PAGE_NUMBER_RE = re.compile(r"^(?:page\s*)?\d{1,2}(?:\s*(?:of|/)\s*\d{1,2})?$", re.IGNORECASE)


def normalize_text(text: str) -> str:
    """Normalise one piece of text (no line structure)."""
    text = unicodedata.normalize("NFKC", text).translate(_INVISIBLE)
    return _SPACES.sub(" ", text).strip()


def strip_bullet(text: str) -> tuple[str, bool]:
    """Remove a leading list marker. Returns (text, had_marker).

    "-" and digits only count as markers when followed by a space, so "-40%"
    or "2021 hackathon" are left alone.
    """
    m = _BULLET_RE.match(text) or _GLUED_BULLET_RE.match(text)
    if not m:
        return text, False
    rest = text[m.end():]
    return (rest, True) if rest.strip() else (text, False)


def _drop_page_furniture(lines: list[Line], dropped: list[str]) -> list[Line]:
    """Remove page headers/footers and page numbers from multi-page documents.

    Deliberately conservative, because removing real content is worse than
    keeping a stray header: a line is furniture only if the same text is the
    first line of *every* page, or the last line of *every* page. Page numbers
    are removed only when they are a page's first or last line. Everything
    removed is recorded in ``dropped`` for the import report.
    """
    pages = sorted({line.page for line in lines})
    if len(pages) < 2:
        return lines
    by_page = {p: [l for l in lines if l.page == p] for p in pages}
    firsts = {by_page[p][0].text.casefold() for p in pages if by_page[p]}
    lasts = {by_page[p][-1].text.casefold() for p in pages if by_page[p]}
    furniture = set()
    if len(firsts) == 1 and all(by_page[p] for p in pages):
        furniture |= firsts
    if len(lasts) == 1 and all(by_page[p] for p in pages):
        furniture |= lasts
    edge_ids = {id(by_page[p][0]) for p in pages if by_page[p]} | {id(by_page[p][-1]) for p in pages if by_page[p]}

    kept = []
    for line in lines:
        at_edge = id(line) in edge_ids
        if at_edge and (line.text.casefold() in furniture or _PAGE_NUMBER_RE.match(line.text)):
            dropped.append(line.text)
            continue
        kept.append(line)
    return kept


def normalize_lines(lines: list[Line], dropped: list[str] | None = None) -> list[Line]:
    """Normalise text, detect bullets, drop empty lines and page furniture.

    Removed page furniture is appended to ``dropped`` so it can be reported.
    """
    dropped = dropped if dropped is not None else []
    result: list[Line] = []
    for line in lines:
        segments = [Segment(normalize_text(s.text), s.bold, s.italic) for s in line.segments]
        segments = [s for s in segments if s.text]
        if not segments:
            continue
        text, had_marker = strip_bullet(segments[0].text)
        if had_marker:
            segments[0] = Segment(text.strip(), segments[0].bold, segments[0].italic)
        line.segments = segments
        line.bullet = line.bullet or had_marker
        result.append(line)
    result = _drop_page_furniture(result, dropped)
    for i, line in enumerate(result):
        line.source_index = i
    return result
