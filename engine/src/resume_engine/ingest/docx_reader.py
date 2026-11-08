"""DOCX -> lines, using python-docx and the underlying XML.

Reads, in document order: the first page header, body paragraphs, tables
(row by row) and text boxes. Tabs split segments; Word list numbering marks
bullets; bold/italic come from runs, falling back to paragraph styles.
"""

from __future__ import annotations

from io import BytesIO

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from .lines import Line, Segment
from .sniff import UnsupportedFile

# python-docx does not register the markup-compatibility namespace used by text boxes.
_MC_CHOICE = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Choice"


def _style_flag(style, attr: str) -> bool | None:
    while style is not None:
        value = getattr(style.font, attr, None)
        if value is not None:
            return value
        style = style.base_style
    return None


def _effective(run, paragraph: Paragraph, attr: str) -> bool:
    value = getattr(run, attr)
    if value is None and run.style is not None and run.style.type is not None:
        value = _style_flag(run.style, attr)
    if value is None:
        value = _style_flag(paragraph.style, attr)
    return bool(value)


def _is_list_item(paragraph: Paragraph) -> bool:
    ppr = paragraph._p.pPr
    if ppr is not None and ppr.numPr is not None:
        return True
    style = paragraph.style
    while style is not None:
        if style.name and "list" in style.name.lower():
            return True
        s_ppr = style.element.pPr
        if s_ppr is not None and s_ppr.numPr is not None:
            return True
        style = style.base_style
    return False


def _paragraph_line(paragraph: Paragraph) -> Line | None:
    segments: list[Segment] = []
    current: list[tuple[str, bool, bool]] = []

    def flush() -> None:
        text = "".join(t for t, _, _ in current)
        if text.strip():
            chars = sum(len(t) for t, _, _ in current) or 1
            bold = sum(len(t) for t, b, _ in current if b) / chars > 0.6
            italic = sum(len(t) for t, _, i in current if i) / chars > 0.6
            segments.append(Segment(text, bold, italic))
        current.clear()

    for child in paragraph._p.iter():
        if child.tag == qn("w:r"):
            run = next((r for r in paragraph.runs if r._r is child), None)
            bold = _effective(run, paragraph, "bold") if run is not None else False
            italic = _effective(run, paragraph, "italic") if run is not None else False
            for node in child:
                if node.tag == qn("w:t"):
                    # Some generators put a literal tab character in the text instead of <w:tab/>.
                    parts = (node.text or "").split("\t")
                    for i, part in enumerate(parts):
                        if i > 0:
                            flush()
                        current.append((part, bold, italic))
                elif node.tag == qn("w:tab"):
                    flush()
                elif node.tag in (qn("w:br"), qn("w:cr")):
                    current.append((" ", bold, italic))
    flush()
    if not segments:
        return None
    return Line(segments=segments, bullet=_is_list_item(paragraph))


def _textbox_paragraphs(p_element, parent) -> list[Paragraph]:
    """Paragraphs inside text boxes anchored in this paragraph (DrawingML first, VML fallback)."""
    found = p_element.findall(".//" + _MC_CHOICE + "//" + qn("w:txbxContent"))
    if not found:
        found = p_element.findall(".//" + qn("w:txbxContent"))
    return [Paragraph(p, parent) for box in found for p in box.findall(qn("w:p"))]


def _table_lines(tbl_element, parent) -> list[Line]:
    lines: list[Line] = []
    for tr in tbl_element.findall(qn("w:tr")):
        cells = tr.findall(qn("w:tc"))
        cell_paras = [[Paragraph(p, parent) for p in tc.findall(qn("w:p"))] for tc in cells]
        nested = [tc.findall(qn("w:tbl")) for tc in cells]
        texts = [[l for p in paras if (l := _paragraph_line(p))] for paras in cell_paras]
        if all(len(t) <= 1 for t in texts) and not any(nested):
            # A layout row like "Title | Dates": one line with a segment per cell.
            segments = [seg for t in texts for line in t for seg in line.segments]
            if segments:
                lines.append(Line(segments=segments, bullet=any(l.bullet for t in texts for l in t)))
        else:
            # Column layout: read each cell top to bottom, left cell first.
            for t, n in zip(texts, nested):
                lines.extend(t)
                for inner in n:
                    lines.extend(_table_lines(inner, parent))
    return lines


def extract_docx_lines(data: bytes) -> list[Line]:
    try:
        document = Document(BytesIO(data))
    except Exception:
        raise UnsupportedFile("This Word document could not be read. It may be damaged or password-protected.") from None

    lines: list[Line] = []
    header = document.sections[0].header if document.sections else None
    if header is not None and not header.is_linked_to_previous:
        for p in header.paragraphs:
            if (line := _paragraph_line(p)) is not None:
                lines.append(line)

    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            if (line := _paragraph_line(paragraph)) is not None:
                lines.append(line)
            for box_p in _textbox_paragraphs(child, document):
                if (line := _paragraph_line(box_p)) is not None:
                    lines.append(line)
        elif child.tag == qn("w:tbl"):
            lines.extend(_table_lines(child, document))
    return lines
