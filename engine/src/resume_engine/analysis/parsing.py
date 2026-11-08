"""Parsing Readiness Score ("ATS score"), 100 points.

  Read-back accuracy 40 | Standard headings 20 | Contact details 15 | Dates 15 | Plain text 10

There is no single "ATS": we cannot replicate any vendor's parser. What we can
measure honestly is how reliably a typical parser reads this document, so the
main criterion is a real round trip: the exported PDF is read back with our
import parser and compared field by field with the resume.
"""

from __future__ import annotations

from ..evals.compare import compare_resumes
from ..evals.import_report import printable, without_unsorted
from ..importer import import_file
from ..ingest import Line, Segment, UnsupportedFile
from ..parse.contact import EMAIL_RE, find_phones, looks_like_name
from ..parse.headings import heading_type
from ..schema import Resume
from . import text as T
from .models import Category, Criterion, Ref, Score, band_for, status_for
from .view import all_text, bullets, dated_items, visible_sections

# Templates whose PDF prints section headings in capitals (mirrors web/src/lib/document/templates.ts).
UPPERCASE_HEADING_TEMPLATES = {"classic", "compact"}

_FIELD_NAMES = {
    "contact.full_name": "your name", "contact.email": "your email", "contact.phone": "your phone number",
    "contact.headline": "your professional title", "contact.location": "your location",
}


def _crit(id: str, label: str, points: float, max_points: float, explanation: str,
          tips: list[str] | None = None, refs: list[Ref] | None = None) -> Criterion:
    points = round(max(0.0, min(points, max_points)), 1)
    return Criterion(id=id, label=label, points=points, max_points=max_points, status=status_for(points, max_points),
                     explanation=explanation, tips=tips or [], refs=(refs or [])[:10])


def _describe(path: str, expected, actual) -> str:
    name = _FIELD_NAMES.get(path, path.split(".")[-1].replace("_", " "))
    if actual in (None, "", []):
        return f"{name.capitalize()} “{expected}” was not found."
    if expected in (None, "", []):
        return f"Extra text was read as {name}: “{actual}”."
    return f"{name.capitalize()} “{expected}” was read as “{actual}”."


def round_trip(resume: Resume, pdf: bytes) -> tuple[float, int, int, list[str], str]:
    """(accuracy, correct, scored, problems, extracted text) from reading the exported PDF back."""
    result = import_file(pdf, "resume.pdf", mode="rules")
    expected = printable(without_unsorted(resume))
    report = compare_resumes(expected, without_unsorted(result.resume))
    problems = [_describe(m.path, m.expected, m.actual) for m in report.mismatches]
    problems += [f"An entry was not recognised: {p.split(' ', 1)[1]}" for p in report.missing_items]
    return report.accuracy, report.correct, report.scored, problems, result.extracted_text


def score_parsing(resume: Resume, pdf: bytes | None) -> tuple[Score, str | None]:
    sections = visible_sections(resume)
    ats_text: str | None = None

    # ---------------------------------------------------------------- read-back (40)
    if pdf is not None:
        try:
            accuracy, correct, scored, problems, ats_text = round_trip(resume, pdf)
            readback = _crit(
                "readback", "Read-back accuracy", 40 * max(0.0, (accuracy - 0.5) / 0.5), 40,
                f"We read your exported PDF back the way a resume parser would: {correct} of {scored} fields were recovered exactly ({accuracy:.0%}).",
                problems[:6],
            )
        except UnsupportedFile as err:
            readback = _crit("readback", "Read-back accuracy", 0, 40, f"The exported PDF could not be read back: {err}")
    else:
        readback = Criterion(id="readback", label="Read-back accuracy", points=0, max_points=0, status="not_measured",
                             explanation="Not measured: no exported PDF was provided.")

    # ---------------------------------------------------------------- headings (20)
    uppercase = resume.meta.template in UPPERCASE_HEADING_TEMPLATES
    recognised, unrecognised = [], []
    for s in sections:
        if not s.items:
            continue
        printed = s.title.upper() if uppercase else s.title
        found = heading_type(Line(segments=[Segment(printed)]))
        ok = found is not None and (found == s.type or s.type == "custom")
        (recognised if ok else unrecognised).append(s)
    total_sections = len(recognised) + len(unrecognised)
    headings = _crit(
        "headings", "Standard section headings", 20 * len(recognised) / total_sections if total_sections else 0, 20,
        f"Headings a parser recognises: {len(recognised)} of {total_sections}."
        + (f" Not recognised: {', '.join(repr(s.title) for s in unrecognised)}." if unrecognised else ""),
        [f"Rename '{s.title}' to a standard heading such as '{ {'experience': 'Experience', 'education': 'Education', 'skills': 'Skills', 'projects': 'Projects', 'summary': 'Summary', 'certifications': 'Certifications', 'languages': 'Languages', 'awards': 'Awards', 'publications': 'Publications'}.get(s.type, 'Additional Information') }'." for s in unrecognised],
        [Ref(section_id=s.id) for s in unrecognised],
    )

    # ---------------------------------------------------------------- contact (15)
    c = resume.contact
    contact_parts = [
        ("name", 5, looks_like_name(c.full_name)),
        ("email", 5, bool(c.email and EMAIL_RE.fullmatch(c.email.strip()))),
        ("phone", 5, bool(c.phone and find_phones(c.phone))),
    ]
    contact = _crit(
        "contact", "Contact details parseable", sum(p for _, p, ok in contact_parts if ok), 15,
        "Name, email and phone are in a standard, machine-readable form."
        if all(ok for *_, ok in contact_parts) else "Not machine-readable or missing: " + ", ".join(n for n, _, ok in contact_parts if not ok) + ".",
        [f"Check your {n}." for n, _, ok in contact_parts if not ok],
    )

    # ---------------------------------------------------------------- dates (15)
    exp = dated_items(resume, ("experience",))
    with_start = [it for it in exp if it.start]
    with_month = [it for it in with_start if it.start.month]
    dates = _crit(
        "dates", "Dates a parser can read", (10 * len(with_start) / len(exp) + 5 * len(with_month) / len(with_start)) if exp and with_start else (15 if not exp else 0), 15,
        f"Roles with a start date: {len(with_start)} of {len(exp)}; with month and year: {len(with_month)}." if exp else "No roles to date.",
        (["Add a start date to every role."] if len(with_start) < len(exp) else [])
        + (["Use month and year (e.g. Mar 2021); many parsers compute experience from them."] if len(with_month) < len(with_start) else []),
        [it.ref for it in exp if it not in with_month],
    )

    # ---------------------------------------------------------------- plain text (10)
    text = all_text(resume)
    symbols = T.has_emoji_or_symbols(text)
    manual_markers = [b for b in bullets(resume) if b.text[:1] in "•●▪■◦○◆►▸➢➤✓✔∙-–*"]
    long_tokens = [w for w in text.split() if len(w) > 60]
    plain = _crit(
        "plain_text", "Plain, clean text", (0 if symbols else 5) + (0 if manual_markers else 3) + (0 if long_tokens else 2), 10,
        "No emoji, decorative symbols or typed bullet characters." if not (symbols or manual_markers or long_tokens)
        else "Found: " + ", ".join(x for x, on in (("emoji/symbols", symbols), ("typed bullet characters", manual_markers),
                                                     ("very long unbroken text", long_tokens)) if on) + ".",
        (["Remove emoji and decorative symbols."] if symbols else [])
        + (["Remove bullet characters you typed at the start of bullets; the template adds them."] if manual_markers else []),
        [b.ref for b in manual_markers],
    )

    criteria = [readback, headings, contact, dates, plain]
    categories = [Category(id=c.id, label=c.label, score=c.points, max_score=c.max_points, criteria=[c]) for c in criteria]
    measured_max = sum(c.max_points for c in criteria)
    total = int(round(100 * sum(c.points for c in criteria) / measured_max)) if measured_max else 0
    weakest = [c for c in criteria if c.status in ("fair", "poor")]
    summary = ("A parser should read this resume reliably." if not weakest
               else "To improve: " + ", ".join(c.label.lower() for c in weakest) + ".")
    if readback.status == "not_measured":
        summary += " (Read-back accuracy not measured.)"
    return Score(total=total, band=band_for(total), summary=summary, categories=categories, measured=pdf is not None), ats_text
