import io

import pytest
from docx import Document

from resume_engine.importer import import_file, import_text
from resume_engine.ingest import Line, Segment, UnsupportedFile, normalize_lines, sniff_kind
from resume_engine.ingest.docx_reader import extract_docx_lines
from resume_engine.ingest.normalize import strip_bullet
from resume_engine.ingest.pdf import ScannedPdf, extract_pdf_lines
from resume_engine.ingest.sniff import FileKind, decode_text


def line(text, page=1):
    return Line(segments=[Segment(text)], page=page)


# ---------------------------------------------------------------- sniffing / decoding

def test_sniff_kinds():
    assert sniff_kind(b"%PDF-1.7 ...") is FileKind.PDF
    assert sniff_kind("Jane Doe\nEngineer".encode()) is FileKind.TEXT
    buf = io.BytesIO()
    Document().save(buf)
    assert sniff_kind(buf.getvalue()) is FileKind.DOCX


@pytest.mark.parametrize(
    "data, message",
    [
        (b"", "empty"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 100, ".doc files are not supported"),
        (b"PK\x03\x04" + b"\0" * 100, "not a Word"),
        (bytes(range(256)) * 20, "not supported"),
        (b"a" * (5 * 1024 * 1024 + 1), "larger than 5 MB"),
    ],
)
def test_sniff_rejects_with_readable_message(data, message):
    with pytest.raises(UnsupportedFile, match=message):
        sniff_kind(data)


def test_decode_text_encodings():
    assert decode_text("Sofía".encode("utf-8")) == "Sofía"
    assert decode_text(b"\xef\xbb\xbfHi") == "Hi"
    assert decode_text("Sofía".encode("utf-16")) == "Sofía"
    assert decode_text("Sofía".encode("cp1252")) == "Sofía"


# ---------------------------------------------------------------- normalisation

@pytest.mark.parametrize(
    "text, expected",
    [
        ("• Led a team", ("Led a team", True)),
        (" Led a team", ("Led a team", True)),
        ("•Led a team", ("Led a team", True)),
        ("- Built it", ("Built it", True)),
        ("1. First", ("First", True)),
        ("-40% latency", ("-40% latency", False)),
        ("K. Watanabe, A. Example", ("K. Watanabe, A. Example", False)),
        ("2021 hackathon winner", ("2021 hackathon winner", False)),
        ("•", ("•", False)),
    ],
)
def test_strip_bullet(text, expected):
    assert strip_bullet(text) == expected


def test_normalize_unicode_and_invisible_characters():
    [result] = normalize_lines([line("Sofía​  ﬁnance team ")])
    assert result.text == "Sofía finance team"


def test_page_footer_on_every_page_is_removed_and_reported():
    lines = [line("Jane Doe"), line("Experience"), line("Page 1 of 2"), line("Education", page=2), line("Page 2 of 2", page=2)]
    dropped: list[str] = []
    kept = normalize_lines(lines, dropped)
    assert [l.text for l in kept] == ["Jane Doe", "Experience", "Education"]
    assert dropped == ["Page 1 of 2", "Page 2 of 2"]


def test_repeated_text_at_different_page_edges_is_kept():
    """Regression: the same school at the bottom of page 1 and top of page 2 is real content."""
    lines = [line("Name"), line("University of Sampleton"), line("University of Sampleton", page=2), line("BSc", page=2)]
    dropped: list[str] = []
    kept = normalize_lines(lines, dropped)
    assert [l.text for l in kept].count("University of Sampleton") == 2
    assert dropped == []


# ---------------------------------------------------------------- PDF / DOCX specifics

MINIMAL_EMPTY_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF"
)


def test_pdf_without_text_is_reported_as_scanned():
    with pytest.raises(ScannedPdf, match="no selectable text"):
        extract_pdf_lines(MINIMAL_EMPTY_PDF)


def test_damaged_pdf_has_readable_error():
    with pytest.raises(UnsupportedFile, match="could not be read"):
        extract_pdf_lines(b"%PDF-1.4 garbage")


def _docx_bytes(build) -> bytes:
    doc = Document()
    build(doc)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_docx_table_layout_rows_become_segmented_lines():
    def build(doc):
        doc.add_paragraph("Jane Doe")
        doc.add_paragraph("EXPERIENCE")
        table = doc.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "Data Analyst"
        table.cell(0, 1).text = "Jan 2020 – Present"
        table.cell(1, 0).text = "Acme Corp"
        table.cell(1, 1).text = "Boston, MA"
        doc.add_paragraph("Built dashboards in SQL.", style="List Bullet")

    lines = normalize_lines(extract_docx_lines(_docx_bytes(build)))
    assert [s.text for s in lines[2].segments] == ["Data Analyst", "Jan 2020 – Present"]
    assert lines[4].bullet

    result = import_file(_docx_bytes(build))
    [exp] = [s for s in result.resume.sections if s.type == "experience"]
    item = exp.items[0]
    assert (item.title, item.organization, item.location, item.current) == ("Data Analyst", "Acme Corp", "Boston, MA", True)
    assert [b.text for b in item.bullets] == ["Built dashboards in SQL."]


def test_docx_literal_tab_in_text_splits_segments():
    def build(doc):
        doc.add_paragraph("Engineer\tMar 2021 – Present")

    [result] = normalize_lines(extract_docx_lines(_docx_bytes(build)))
    assert [s.text for s in result.segments] == ["Engineer", "Mar 2021 – Present"]


def test_docx_bold_from_runs():
    def build(doc):
        p = doc.add_paragraph()
        p.add_run("Bold title").bold = True

    [result] = extract_docx_lines(_docx_bytes(build))
    assert result.bold


# ---------------------------------------------------------------- pipeline

def test_import_text_empty_and_too_long():
    with pytest.raises(UnsupportedFile, match="empty"):
        import_text("   ")
    with pytest.raises(UnsupportedFile, match="too long"):
        import_text("a" * 70_000)


def test_extracted_text_is_returned():
    result = import_text("Jane Doe\njane@example.com\nSKILLS\nPython, SQL")
    assert "Python, SQL" in result.extracted_text
    assert result.source == "text"
