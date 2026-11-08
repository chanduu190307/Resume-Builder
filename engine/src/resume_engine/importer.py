"""Import pipeline: bytes or pasted text -> lines -> normalised -> Resume + report.

1. The deterministic rule parser always runs first.
2. If it could not place every line (an unusual layout) and an AI model is
   configured, AI-assisted extraction runs too. Its output is verified against
   the document text (unsupported values are discarded) and is used only if it
   accounts for more of the document than the rules did.
3. Scanned PDFs (no text layer) can only be read with AI.

``mode="rules"`` forces the deterministic parser only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .ingest import FileKind, Line, UnsupportedFile, normalize_lines, sniff_kind
from .ingest.docx_reader import extract_docx_lines
from .ingest.pdf import ScannedPdf, extract_pdf_lines
from .ingest.sniff import decode_text
from .ingest.text import extract_text_lines
from .llm import LLMError, get_llm
from .llm.extract import extract_scanned_pdf, extract_with_llm, uncovered_lines
from .parse.parser import UNSORTED_TITLE, ParseReport, parse_lines
from .schema import Bullet, CustomItem, CustomSection, Resume

MAX_TEXT_CHARS = 60_000


@dataclass
class ImportResult:
    resume: Resume
    report: ParseReport
    source: str
    method: str = "rules"
    extracted_text: str = ""
    """The normalised text, line by line: what a parser 'sees' (used by later ATS views)."""
    notes: list[str] = field(default_factory=list)


def _lines_to_text(lines: list[Line]) -> str:
    return "\n".join(("• " if l.bullet else "") + "   ".join(s.text for s in l.segments) for l in lines)


def _with_unsorted(resume: Resume, unplaced: list[str]) -> Resume:
    resume.sections = [s for s in resume.sections if not (s.type == "custom" and s.title == UNSORTED_TITLE)]
    if unplaced:
        resume.sections.append(
            CustomSection(title=UNSORTED_TITLE, visible=False, items=[CustomItem(bullets=[Bullet(text=t) for t in unplaced])])
        )
    return resume


def _discard_note(discarded: list[str]) -> list[str]:
    if not discarded:
        return []
    shown = ", ".join(f"'{d[:60]}'" for d in discarded[:5])
    more = f" and {len(discarded) - 5} more" if len(discarded) > 5 else ""
    return [f"AI suggested {len(discarded)} value(s) that are not in your document; they were discarded: {shown}{more}."]


# Rules-stage "missing contact" warnings that no longer apply once AI found the value.
_CONTACT_WARNINGS = {
    "No name was found.": lambda r: r.contact.full_name,
    "No email address was found.": lambda r: r.contact.email,
    "No phone number was found.": lambda r: r.contact.phone,
}


def _resolved_by(warning: str, resume: Resume) -> bool:
    return any(warning.startswith(prefix) and bool(found(resume)) for prefix, found in _CONTACT_WARNINGS.items())


def _try_llm(result: ImportResult, lines: list[Line]) -> ImportResult:
    llm = get_llm()
    if llm is None:
        return result
    try:
        resume, discarded = extract_with_llm(llm, result.extracted_text)
    except LLMError as err:
        result.notes.append(f"AI-assisted import was not available: {err}")
        return result
    missing = uncovered_lines(lines, resume)
    if len(missing) >= len(result.report.unplaced):
        result.notes.append("AI-assisted import was tried but did not improve on the standard parser.")
        return result
    report = ParseReport(
        warnings=[w for w in result.report.warnings if "could not be placed" not in w and not _resolved_by(w, resume)],
        unplaced=missing,
        sections_found=[s.type for s in resume.sections],
    )
    if missing:
        report.warnings.append(
            f"{len(missing)} line(s) could not be placed automatically. They are kept in the hidden "
            f"section '{UNSORTED_TITLE}' so nothing is lost; please review them."
        )
    return ImportResult(
        resume=_with_unsorted(resume, missing),
        report=report,
        source=result.source,
        method="llm",
        extracted_text=result.extracted_text,
        notes=result.notes
        + ["Your resume layout was unusual, so AI helped organise it. Every value was checked against your document."]
        + _discard_note(discarded),
    )


def _run(lines: list[Line], source: str, wrapped: bool, mode: str) -> ImportResult:
    dropped: list[str] = []
    lines = normalize_lines(lines, dropped)
    if not lines:
        raise UnsupportedFile("No text was found in this document.")
    resume, report = parse_lines(lines, wrapped=wrapped)
    notes = [f"Removed repeated page header/footer or page number: '{t}'" for t in dropped]
    result = ImportResult(resume=resume, report=report, source=source, extracted_text=_lines_to_text(lines), notes=notes)
    if mode == "auto" and report.unplaced:
        result = _try_llm(result, lines)
    return result


def import_text(text: str, mode: str = "auto") -> ImportResult:
    if not text.strip():
        raise UnsupportedFile("The pasted text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise UnsupportedFile("The pasted text is too long for a resume (over 60,000 characters).")
    return _run(extract_text_lines(text), "text", wrapped=True, mode=mode)


def _import_scanned(data: bytes, err: ScannedPdf, mode: str) -> ImportResult:
    llm = get_llm() if mode == "auto" else None
    if llm is None:
        raise err
    try:
        resume, discarded, transcription = extract_scanned_pdf(llm, data)
    except LLMError as llm_err:
        raise ScannedPdf(f"{err} (AI reading also failed: {llm_err})") from None
    lines = normalize_lines(extract_text_lines(transcription))
    missing = uncovered_lines(lines, resume)
    report = ParseReport(
        warnings=["This PDF is a scanned image, so its text was read by AI. Check every field carefully."],
        unplaced=missing,
        sections_found=[s.type for s in resume.sections],
    )
    return ImportResult(
        resume=_with_unsorted(resume, missing),
        report=report,
        source="pdf",
        method="llm-ocr",
        extracted_text=_lines_to_text(lines),
        notes=_discard_note(discarded),
    )


def import_file(data: bytes, filename: str = "", mode: str = "auto") -> ImportResult:
    kind = sniff_kind(data, filename)
    if kind is FileKind.PDF:
        try:
            lines = extract_pdf_lines(data)
        except ScannedPdf as err:
            return _import_scanned(data, err, mode)
        return _run(lines, "pdf", wrapped=True, mode=mode)
    if kind is FileKind.DOCX:
        # A Word paragraph is a complete unit: never join paragraphs as wrapped lines.
        return _run(extract_docx_lines(data), "docx", wrapped=False, mode=mode)
    return import_text(decode_text(data), mode=mode)
