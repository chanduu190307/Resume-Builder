"""PDF -> lines, using pdfplumber (MIT licensed, pure Python).

Layout handling:
* Words are grouped into lines by vertical position.
* A large horizontal gap splits a line into segments (title ... date).
* Two-column pages are detected by a vertical gutter that no word crosses;
  the left column is read before the right one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from statistics import median

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect, PDFEncryptionError
from pdfplumber.utils.exceptions import PdfminerException

from .lines import Line, Segment
from .sniff import UnsupportedFile

MAX_PAGES = 10
LINE_TOLERANCE = 2.5  # points of vertical jitter within one line
MIN_TEXT_CHARS = 40  # below this a PDF is treated as scanned / image-only


class ScannedPdf(UnsupportedFile):
    """The PDF has (almost) no extractable text, e.g. a scan."""


@dataclass
class _Word:
    text: str
    x0: float
    x1: float
    top: float
    size: float
    bold: bool
    italic: bool


def _style(fontname: str) -> tuple[bool, bool]:
    name = fontname.split("+")[-1].lower()
    bold = any(k in name for k in ("bold", "black", "heavy", "semibold", "demi"))
    italic = any(k in name for k in ("italic", "oblique"))
    return bold, italic


def _words(page) -> list[_Word]:
    raw = page.extract_words(keep_blank_chars=False, use_text_flow=False, extra_attrs=["fontname", "size"])
    out = []
    for w in raw:
        bold, italic = _style(w.get("fontname", ""))
        out.append(_Word(w["text"], w["x0"], w["x1"], w["top"], float(w.get("size", 10)), bold, italic))
    return out


def _find_gutter(words: list[_Word], width: float) -> float | None:
    """Return the x of a vertical gutter separating two text columns, if any."""
    if len(words) < 30:
        return None
    lo, hi = width * 0.2, width * 0.8
    step = 2.0
    covered = []
    x = lo
    while x <= hi:
        covered.append((x, any(w.x0 - 1 <= x <= w.x1 + 1 for w in words)))
        x += step
    best: tuple[float, float] | None = None
    start = None
    for x, cov in covered + [(hi + step, True)]:
        if not cov and start is None:
            start = x
        elif cov and start is not None:
            if x - start >= 12 and (best is None or x - start > best[1] - best[0]):
                best = (start, x)
            start = None
    if best is None:
        return None
    gutter = (best[0] + best[1]) / 2
    left = [w for w in words if w.x1 <= gutter]
    right = [w for w in words if w.x0 >= gutter]
    # Both sides need real content spread over many lines, otherwise it is just
    # a right-aligned date column in a single-column layout.
    def rows(ws: list[_Word]) -> int:
        return len({round(w.top / LINE_TOLERANCE) for w in ws})
    if rows(left) < 8 or rows(right) < 8:
        return None
    right_alone = sum(1 for w in right if not any(abs(l.top - w.top) < LINE_TOLERANCE for l in left))
    left_alone = sum(1 for w in left if not any(abs(r.top - w.top) < LINE_TOLERANCE for r in right))
    if right_alone < 10 or left_alone < 10:
        return None
    return gutter


@dataclass
class _Geo:
    """Geometry kept alongside each line for wrap detection."""

    x1: float
    top: float
    bottom: float
    first_word_width: float


def _group_lines(words: list[_Word], page_no: int, column: int) -> list[tuple[Line, _Geo]]:
    words = sorted(words, key=lambda w: (w.top, w.x0))
    rows: list[list[_Word]] = []
    for w in words:
        if rows and abs(rows[-1][0].top - w.top) <= LINE_TOLERANCE:
            rows[-1].append(w)
        else:
            rows.append([w])
    lines = []
    for row in rows:
        row.sort(key=lambda w: w.x0)
        size = median(w.size for w in row)
        gap_limit = max(7.0, 0.9 * size)
        segments: list[list[_Word]] = [[row[0]]]
        for prev, w in zip(row, row[1:]):
            if w.x0 - prev.x1 > gap_limit:
                segments.append([w])
            else:
                segments[-1].append(w)
        segs = []
        for seg in segments:
            text = " ".join(w.text for w in seg)
            chars = sum(len(w.text) for w in seg) or 1
            bold = sum(len(w.text) for w in seg if w.bold) / chars > 0.6
            italic = sum(len(w.text) for w in seg if w.italic) / chars > 0.6
            segs.append(Segment(text, bold, italic))
        # x0 of the first real word (after a bullet glyph) for wrapped-bullet detection.
        first = row[1] if len(row) > 1 and len(row[0].text) == 1 and not row[0].text.isalnum() else row[0]
        geo = _Geo(
            x1=max(w.x1 for w in row),
            top=min(w.top for w in row),
            bottom=max(w.top + w.size for w in row),
            first_word_width=first.x1 - first.x0,
        )
        lines.append((Line(segments=segs, page=page_no, x0=first.x0, size=size, column=column), geo))
    return lines


_LABEL_START = re.compile(r"^[A-Za-z][A-Za-z /&+.-]{0,30}:\s")
_CONTACTISH = re.compile(r"@|https?://|www\.|\+?\d[\d\s().-]{7,}\d")


def _is_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 3 and all(c.isupper() for c in letters)


def _merge_wraps(lines: list[tuple[Line, _Geo]]) -> list[Line]:
    """Join lines that are one paragraph wrapped by the layout.

    Typographic test: the next line's first word would not have fitted at the
    end of the previous line. Lines must also share style and indent, have
    normal line spacing, and not look like a new list item, label or contact.
    """
    if not lines:
        return []
    right_edge = max(g.x1 for _, g in lines)
    out: list[tuple[Line, _Geo]] = []
    for line, geo in lines:
        if out:
            prev, pgeo = out[-1]
            seg_prev, seg_next = prev.segments[-1], line.segments[0]
            first_text = seg_next.text
            space = 0.3 * (line.size or 10)
            if (
                len(prev.segments) == 1
                and len(line.segments) == 1
                and prev.bold == line.bold
                and prev.italic == line.italic
                and abs((prev.size or 10) - (line.size or 10)) < 0.5
                and _is_caps(seg_prev.text) == _is_caps(first_text)
                and prev.x0 is not None
                and line.x0 is not None
                and abs(line.x0 - prev.x0) <= 2.5
                and 0 <= geo.top - pgeo.bottom <= 0.6 * (line.size or 10)
                and pgeo.x1 + space + geo.first_word_width > right_edge - 1
                and not first_text[:1] in "•●▪■◦○◆►▸➢➤✓✔∙-–*"
                and not _LABEL_START.match(first_text)
                and not _CONTACTISH.search(first_text)
                and not _CONTACTISH.search(seg_prev.text)
            ):
                joiner = "" if seg_prev.text.endswith("-") and first_text[:1].islower() else " "
                seg_prev.text = seg_prev.text + joiner + first_text
                pgeo.x1, pgeo.bottom = geo.x1, geo.bottom
                continue
        out.append((line, geo))
    return [line for line, _ in out]


def extract_pdf_lines(data: bytes) -> list[Line]:
    try:
        pdf = pdfplumber.open(BytesIO(data))
    except (PDFPasswordIncorrect, PDFEncryptionError):
        raise UnsupportedFile("This PDF is password-protected. Remove the password and try again.") from None
    except PdfminerException as err:
        if "password" in str(err).lower() or "encrypt" in str(err).lower():
            raise UnsupportedFile("This PDF is password-protected. Remove the password and try again.") from None
        raise UnsupportedFile("This PDF could not be read. It may be damaged.") from None
    except Exception:
        raise UnsupportedFile("This PDF could not be read. It may be damaged.") from None

    with pdf:
        if len(pdf.pages) > MAX_PAGES:
            raise UnsupportedFile(f"This PDF has {len(pdf.pages)} pages; resumes longer than {MAX_PAGES} pages are not supported.")
        lines: list[Line] = []
        total_chars = 0
        for page_no, page in enumerate(pdf.pages, start=1):
            words = _words(page)
            total_chars += sum(len(w.text) for w in words)
            gutter = _find_gutter(words, float(page.width))
            if gutter is None:
                lines += _merge_wraps(_group_lines(words, page_no, 0))
            else:
                lines += _merge_wraps(_group_lines([w for w in words if w.x1 <= gutter], page_no, 0))
                lines += _merge_wraps(_group_lines([w for w in words if w.x1 > gutter], page_no, 1))
    if total_chars < MIN_TEXT_CHARS:
        raise ScannedPdf(
            "This PDF has no selectable text (it is probably a scan or an image). "
            "Paste your resume text instead, or upload the original Word/PDF file."
        )
    return lines
