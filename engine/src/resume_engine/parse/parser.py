"""Rule-based parser: normalised lines -> canonical Resume + report.

Principles
----------
* Deterministic: the same lines always give the same result.
* Truthful: every value comes from the document; nothing is invented. Text is
  only split and assigned to fields, never rewritten.
* Nothing is silently dropped: every line is either placed into a field or
  reported as unplaced (and kept in a hidden "Imported text to review" section).
* Layout hints (segments, bold/italic, x positions) improve accuracy but the
  parser also works on plain text, so all input formats behave alike.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..ingest import Line
from ..schema import (
    AwardItem,
    AwardsSection,
    Bullet,
    CertificationItem,
    CertificationsSection,
    Contact,
    CustomItem,
    CustomSection,
    EducationItem,
    EducationSection,
    ExperienceItem,
    ExperienceSection,
    LanguageItem,
    LanguagesSection,
    Link,
    ProjectItem,
    ProjectsSection,
    PublicationItem,
    PublicationsSection,
    Resume,
    SkillGroup,
    SkillsSection,
    SummaryItem,
    SummarySection,
)
from . import contact as C
from .dates import DateMatch, find_cert_dates, find_range, remove_span
from .headings import display_title, heading_type, is_known_heading, normalize_heading

UNSORTED_TITLE = "Imported text to review"

# ----------------------------------------------------------------------------- vocabulary

_TITLE_WORDS = re.compile(
    r"\b(engineer|developer|programmer|manager|intern|internship|analyst|teacher|tutor|nurse|assistant|"
    r"specialist|lead|director|consultant|designer|scientist|researcher|coordinator|officer|associate|"
    r"architect|administrator|technician|executive|head|president|founder|co-?founder|owner|representative|"
    r"advisor|adviser|accountant|editor|writer|instructor|lecturer|professor|fellow|trainee|apprentice|"
    r"volunteer|member|chair|captain|supervisor|clerk|agent|operator|strategist|marketer|recruiter|"
    r"therapist|physician|doctor|pharmacist|staff|cto|ceo|cfo|vp|sde|swe)\b",
    re.IGNORECASE,
)
_ORG_WORDS = re.compile(
    r"\b(inc|ltd|llc|llp|plc|gmbh|corp|corporation|company|co|group|labs?|technologies|technology|"
    r"solutions|systems|software|services|consulting|partners|bank|university|college|institute|school|"
    r"academy|hospital|clinic|foundation|association|agency|studio|studios|ventures|holdings|retail|"
    r"payments|logistics|importers|works|self-employed|freelance)\b",
    re.IGNORECASE,
)
_INSTITUTION_WORDS = re.compile(
    r"\b(university|universidad|universit[éeà]|college|institute|institut|school|academy|polytechnic|"
    r"iit|nit|iiit|conservatory|seminary|faculty|campus)\b",
    re.IGNORECASE,
)
_DEGREE_WORDS = re.compile(
    r"\b(bachelor|master|doctor|doctorate|ph\.?\s?d|mba|msc|bsc|ba|bs|ms|ma|meng|beng|btech|mtech|"
    r"b\.\s?[a-z]{1,4}\.?|m\.\s?[a-z]{1,4}\.?|associate|diploma|certificate|pgce|gcse|a-levels?|"
    r"high school|secondary|pre-university|hsc|ssc|grado|licenciatura|degree|bsn|llb|llm|md)\b",
    re.IGNORECASE,
)
_GRADE_RE = re.compile(
    r"(\bc?gpa\b|\bgrade\b|\bmarks?\b|\bpercentage\b|\d{1,3}(?:\.\d+)?\s*%|\d(?:\.\d+)?\s*/\s*(?:4|5|10)(?:\.0)?\b|"
    r"\bhonou?rs\b|first class|second class|distinction|cum laude|magna|summa|merit)",
    re.IGNORECASE,
)
_EMPLOYMENT_SUFFIX = re.compile(
    r"\s*(?:[·•|,–—-]\s*|\()\s*(full[- ]time|part[- ]time|internship|contract|freelance|volunteer(?:ing)?)\s*\)?\s*$",
    re.IGNORECASE,
)
_EMPLOYMENT_MAP = {
    "full-time": "full_time", "full time": "full_time", "part-time": "part_time", "part time": "part_time",
    "internship": "internship", "contract": "contract", "freelance": "freelance",
    "volunteer": "volunteer", "volunteering": "volunteer",
}
_LABEL_RE = re.compile(r"^([A-Za-z][A-Za-z /&+.-]{0,30}?)\s*:\s+(\S.*)$")
_TECH_LABELS = {"technologies", "technology", "tech", "tech stack", "stack", "tools", "tools used",
                "technologies used", "environment", "skills used", "built with", "tools and technologies"}
_CREDENTIAL_LABELS = {"credential id", "credential", "license number", "licence number", "license no",
                      "certificate id", "certificate number", "id"}
_SPLIT_PIPES = re.compile(r"\s+\|\s+")
_AUTHOR_HINT = re.compile(r"\b[A-Z]\.\s?[A-Z]?\.?\s?[A-Z][a-z]|et al\.?|\band\b")


def _words(text: str) -> int:
    return len(text.split())


def _score(regex: re.Pattern[str], text: str) -> int:
    return len(regex.findall(text))


def join_wrapped(parts: list[str]) -> str:
    """Join wrapped lines; "event-" + "driven" keeps the hyphen without a space."""
    out = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if not out:
            out = part
        elif out.endswith("-") and part[:1].islower():
            out += part
        else:
            out += " " + part
    return out


def split_top_level(text: str, seps: str = ",;•|·") -> list[str]:
    """Split on separators that are not inside parentheses: "Python (pandas, NumPy), SQL"."""
    items, depth, buf = [], 0, ""
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            items.append(buf)
            buf = ""
        else:
            buf += ch
    items.append(buf)
    return [i.strip() for i in items if i.strip()]


# "Father’s Name : X", "D.O.B : 28-04-2006", "Date :" in custom sections (value may be empty).
_KEY_VALUE_RE = re.compile(r"^\s*[^\W\d_][\w .’'/&+()-]{0,30}?\s*:(\s|$)")

_EMPTY_LABEL_RE = re.compile(
    r"^\s*(description|project description|details|responsibilities|key responsibilities|achievements|"
    r"key achievements|highlights|key highlights|features|key features|contributions|overview|summary|tasks)\s*:\s*$",
    re.IGNORECASE,
)


def label_of(text: str) -> tuple[str, str] | None:
    m = _LABEL_RE.match(text)
    if not m or _words(m.group(1)) > 4:
        return None
    if "http" in m.group(1).lower():
        return None
    return m.group(1).strip(), m.group(2).strip()


def _style(line: Line) -> tuple[float, bool] | None:
    """Font size (to the nearest half point) and boldness, or None when the source has no sizes."""
    return (round(line.size * 2) / 2, line.bold) if line.size else None


def _known_heading_styles(lines: list[Line]) -> set[tuple[float, bool]]:
    """Styles of this document's recognised section headings ("Education", "SKILLS"...)."""
    styles = {_style(l) for l in lines if is_known_heading(l)}
    styles.discard(None)
    return styles  # type: ignore[return-value]


# ----------------------------------------------------------------------------- data

@dataclass
class ParseReport:
    warnings: list[str] = field(default_factory=list)
    unplaced: list[str] = field(default_factory=list)
    sections_found: list[str] = field(default_factory=list)


@dataclass
class _Piece:
    text: str
    bold: bool
    italic: bool
    line: int
    right: bool  # not the first segment on its line (right-aligned column)


@dataclass
class _Entry:
    header: list[Line] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)
    labels: list[tuple[str, str]] = field(default_factory=list)
    body: list[Line] = field(default_factory=list)
    date_idx: int | None = None
    header_done: bool = False
    last_bullet: Line | None = None


@dataclass
class _RawSection:
    type: str
    title: str
    lines: list[Line] = field(default_factory=list)


# ----------------------------------------------------------------------------- parser

class ResumeParser:
    def __init__(self, lines: list[Line], *, wrapped: bool = True):
        """``wrapped`` is False for sources where a line is a whole paragraph (DOCX)."""
        self.lines = lines
        self.wrapped = wrapped
        self.report = ParseReport()
        self.placed: set[int] = set()
        self.leftovers: list[str] = []

    # -- helpers ---------------------------------------------------------------
    def _place(self, *lines: Line) -> None:
        self.placed.update(l.source_index for l in lines)

    def _leftover(self, text: str) -> None:
        if text.strip():
            self.leftovers.append(text.strip())

    def _warn(self, message: str) -> None:
        if message not in self.report.warnings:
            self.report.warnings.append(message)

    # -- top level -------------------------------------------------------------
    def parse(self) -> tuple[Resume, ParseReport]:
        header, sections = self._split_sections()
        contact, implicit_summary = self._parse_header(header)

        built = []
        if implicit_summary and not any(s.type == "summary" for s in sections):
            built.append(SummarySection(title="Summary", items=[SummaryItem(text=implicit_summary)]))
        for raw in sections:
            self.report.sections_found.append(raw.type)
            section = self._parse_section(raw)
            if section is not None:
                built.append(section)

        unplaced = [l.text for l in self.lines if l.source_index not in self.placed] + self.leftovers
        self.report.unplaced = unplaced
        if unplaced:
            built.append(
                CustomSection(
                    title=UNSORTED_TITLE,
                    visible=False,
                    items=[CustomItem(bullets=[Bullet(text=t) for t in unplaced])],
                )
            )
            self._warn(
                f"{len(unplaced)} line(s) could not be placed automatically. They are kept in the hidden "
                f"section '{UNSORTED_TITLE}' so nothing is lost; please review them."
            )
        if not contact.full_name:
            self._warn("No name was found. Please add it in Contact details.")
        if not contact.email:
            self._warn("No email address was found.")
        if not contact.phone:
            self._warn("No phone number was found.")
        return Resume(contact=contact, sections=built), self.report

    def _split_sections(self) -> tuple[list[Line], list[_RawSection]]:
        header: list[Line] = []
        sections: list[_RawSection] = []
        heading_styles = _known_heading_styles(self.lines)
        for i, line in enumerate(self.lines):
            kind = heading_type(line)
            if kind is not None and not is_known_heading(line):
                # An unknown ALL-CAPS line is only a heading if it looks like this document's real
                # headings. A name in capitals ("CHARAN S", larger) or a project title in capitals
                # (smaller) is not. The first line of a document is never an unknown heading.
                if i == 0 or (heading_styles and _style(line) not in heading_styles):
                    kind = None
            if kind is not None:
                sections.append(_RawSection(kind, display_title(line.text)))
                self._place(line)
            elif sections:
                sections[-1].lines.append(line)
            else:
                header.append(line)
        return header, sections

    # -- header / contact ------------------------------------------------------
    def _parse_header(self, lines: list[Line]) -> tuple[Contact, str | None]:
        emails: list[str] = []
        phones: list[str] = []
        urls: list[str] = []
        location: str | None = None
        name: str | None = None
        headline: str | None = None
        paragraphs: list[Line] = []
        previous_was_name = False

        for line in lines:
            text = line.text
            line_emails = C.find_emails(text)
            line_phones = C.find_phones(C.EMAIL_RE.sub(" ", text))
            line_urls = C.find_urls(text)
            parts = C.split_contact_parts(text)
            leftover_parts = []
            for part in parts:
                if C.EMAIL_RE.search(part) or any(p in part for p in line_phones) or any(u in part for u in line_urls):
                    continue
                standalone_ok = len(parts) == 1 and (C.is_strict_location(part) or headline is not None)
                if C.is_location(part) and location is None and (line_emails or line_phones or line_urls or standalone_ok):
                    location = part
                    continue
                leftover_parts.append(part)
            is_contact_line = bool(line_emails or line_phones or line_urls) or (
                location is not None and not leftover_parts and len(parts) >= 1 and name is not None
            )
            emails += line_emails
            phones += line_phones
            urls += line_urls
            if is_contact_line:
                previous_was_name = False
                self._place(line)
                for part in leftover_parts:
                    self._leftover(part)
                continue
            if name is None and C.looks_like_name(text):
                name = text
                self._place(line)
                previous_was_name = True
                continue
            if headline is None and previous_was_name and _words(text) <= 12 and not text.endswith("."):
                # A headline is the line directly under the name ("Senior Software Engineer").
                headline = text
                self._place(line)
            elif _words(text) >= 12:
                paragraphs.append(line)
            previous_was_name = False
            # anything else stays unplaced and is reported

        summary = None
        if paragraphs:
            summary = join_wrapped([p.text for p in paragraphs])
            self._place(*paragraphs)

        seen: set[str] = set()
        links = []
        for url in urls:
            key = url.lower().removeprefix("https://").removeprefix("http://").removeprefix("www.").rstrip("/")
            if key not in seen:
                seen.add(key)
                links.append(Link(kind=C.link_kind(url), url=url))
        contact = Contact(
            full_name=name or "",
            headline=headline,
            email=emails[0] if emails else None,
            phone=phones[0] if phones else None,
            location=location,
            links=links,
        )
        for extra in emails[1:] + phones[1:]:
            self._leftover(extra)
        return contact, summary

    # -- sections --------------------------------------------------------------
    def _parse_section(self, raw: _RawSection):
        if not raw.lines:
            return None
        parser = {
            "summary": self._summary,
            "skills": self._skills,
            "languages": self._languages,
        }.get(raw.type)
        if parser is not None:
            return parser(raw)
        entries = self._segment(raw.lines, raw.type)
        return {
            "experience": self._experience,
            "education": self._education,
            "projects": self._projects,
            "certifications": self._certifications,
            "publications": self._publications,
            "awards": self._awards,
            "custom": self._custom,
        }[raw.type](raw, entries)

    def _summary(self, raw: _RawSection) -> SummarySection:
        self._place(*raw.lines)
        kind = "objective" if "objective" in normalize_heading(raw.title) else "summary"
        text = join_wrapped([l.text for l in raw.lines])
        return SummarySection(title=raw.title, items=[SummaryItem(kind=kind, text=text)])

    def _skills(self, raw: _RawSection) -> SkillsSection:
        groups: list[list[str | None]] = []  # [name, raw text]
        prev_text = ""
        for line in raw.lines:
            text = line.text
            lab = label_of(text)
            if lab:
                groups.append([lab[0], lab[1]])
            elif groups and (prev_text.rstrip().endswith(",") or text[:1].islower()):
                groups[-1][1] = join_wrapped([groups[-1][1] or "", text])
            else:
                groups.append([None, text])
            prev_text = text
            self._place(line)
        items = []
        for name, text in groups:
            skills = split_top_level(text or "")
            if not skills:
                continue
            kind = "technical"
            lowered = (name or "").lower()
            if "tool" in lowered or "software" in lowered or "system" in lowered:
                kind = "tool"
            elif any(k in lowered for k in ("soft", "professional", "interpersonal", "personal")):
                kind = "soft"
            items.append(SkillGroup(name=name, kind=kind, skills=skills))
        return SkillsSection(title=raw.title, items=items)

    def _languages(self, raw: _RawSection) -> LanguagesSection:
        items = []
        for line in raw.lines:
            self._place(line)
            for part in split_top_level(line.text, seps=",;•|·"):
                m = re.match(r"^([^(:–—-]+?)\s*(?:\((.*)\)|[:–—-]\s*(.+))?$", part)
                if not m:
                    self._leftover(part)
                    continue
                language = m.group(1).strip()
                proficiency = (m.group(2) or m.group(3) or "").strip() or None
                items.append(LanguageItem(language=language, proficiency=proficiency))
        return LanguagesSection(title=raw.title, items=items)

    # -- entry segmentation ----------------------------------------------------
    def _has_date(self, text: str, kind: str) -> bool:
        if kind == "certifications":
            return find_cert_dates(text) is not None
        return find_range(text) is not None

    def _is_continuation(self, line: Line, entry: _Entry, margin: float | None) -> bool:
        last = entry.last_bullet
        if last is None or not self.wrapped or line.bold:
            return False
        if find_range(line.text) is not None:
            return False
        if line.x0 is not None and last.x0 is not None and margin is not None:
            return abs(line.x0 - last.x0) <= 2.5 and line.x0 > margin + 3
        previous = entry.bullets[-1].rstrip()
        return not previous.endswith((".", "!", "?")) or line.text[:1].islower()

    def _starts_new(self, entry: _Entry, line: Line, has_date: bool, kind: str) -> bool:
        if entry.bullets or entry.labels:
            return True
        if not entry.header_done:
            if (
                line.bold
                and not has_date
                and len(entry.header) >= 2
                and entry.header[0].bold
                and not any(h.bold for h in entry.header[1:])
            ):
                # Bold title + plain line(s) so far, and here is the next bold title: entries
                # without dates (e.g. "Course name" / "Issuer" certifications) start here.
                return True
            return has_date and entry.date_idx is not None
        if line.bold and entry.header and entry.header[0].bold:
            return True  # titles are bold in this document, and this is the next title
        text = line.text
        if kind == "education":
            if has_date and entry.date_idx is not None:
                return True  # this entry already has its dates; a new dated line is the next school
            return not (_GRADE_RE.search(text) and _words(text) <= 8) and _words(text) < 9
        if kind == "publications":
            return has_date
        if kind == "certifications":
            return not C.find_urls(text)
        if kind == "awards":
            return _words(text) < 6
        return _words(text) < 9

    def _segment(self, lines: list[Line], kind: str) -> list[_Entry]:
        margins: dict[tuple[int, int], float] = {}
        for l in lines:
            if l.x0 is not None:
                key = (l.page, l.column)
                margins[key] = min(margins.get(key, l.x0), l.x0)

        entries: list[_Entry] = []
        cur: _Entry | None = None
        for line in lines:
            self._place(line)
            text = line.text
            margin = margins.get((line.page, line.column))
            if (
                line.bullet
                and kind in ("projects", "experience")
                and line.bold
                and _words(text) <= 6
                and line.x0 is not None
                and margin is not None
                and line.x0 <= margin + 3
            ):
                # "2. VOLTFLOW AI": a short bold numbered title at the section's left margin
                # starts the next entry; real bullets are indented and not bold.
                line.bullet = False
            if line.bullet:
                if cur is None:
                    cur = _Entry()
                    entries.append(cur)
                cur.bullets.append(text)
                cur.last_bullet = line
                cur.header_done = True
                continue
            if cur is not None and _EMPTY_LABEL_RE.match(text):
                continue  # "Description:" / "Key achievements:" introduces the bullets; nothing to keep
            lab = label_of(text)
            if lab and cur is not None and (
                lab[0].lower() in _TECH_LABELS | _CREDENTIAL_LABELS or cur.header_done or cur.bullets
            ):
                cur.labels.append(lab)
                cur.header_done = True
                continue
            if cur is not None and self._is_continuation(line, cur, margins.get((line.page, line.column))):
                cur.bullets[-1] = join_wrapped([cur.bullets[-1], text])
                continue
            has_date = self._has_date(text, kind)
            if cur is None or self._starts_new(cur, line, has_date, kind):
                cur = _Entry()
                entries.append(cur)
            if not cur.header_done:
                prev = cur.header[-1] if cur.header else None
                if (
                    prev is not None
                    and line.bold
                    and prev.bold
                    and not has_date
                    and cur.date_idx is None
                    and len(prev.segments) == 1
                    and len(line.segments) == 1
                ):
                    # A bold title wrapped onto a second line.
                    prev.segments[0].text = join_wrapped([prev.segments[0].text, line.segments[0].text])
                    continue
                cur.header.append(line)
                if has_date and cur.date_idx is None:
                    cur.date_idx = len(cur.header) - 1
                if (cur.date_idx is not None and (cur.date_idx >= 1 or len(cur.header) >= 2)) or len(cur.header) >= 3:
                    cur.header_done = True
            else:
                cur.body.append(line)
        return entries

    # -- header pieces ---------------------------------------------------------
    def _pieces(self, entry: _Entry) -> list[_Piece]:
        pieces = []
        for i, line in enumerate(entry.header):
            for j, seg in enumerate(line.segments):
                for k, part in enumerate(_SPLIT_PIPES.split(seg.text)):
                    part = part.strip(" |")
                    if part:
                        pieces.append(_Piece(part, seg.bold, seg.italic, i, j > 0 or k > 0))
        return pieces

    def _take_date(self, entry: _Entry, pieces: list[_Piece], kind: str):
        """Find the date in the header, remove it from its piece. Returns the match."""
        order = sorted(range(len(pieces)), key=lambda i: (pieces[i].line != (entry.date_idx or 0), i))
        for i in order:
            piece = pieces[i]
            if kind == "certifications":
                found = find_cert_dates(piece.text)
                if found:
                    issued, expires, span, raw = found
                    piece.text = remove_span(piece.text, span)
                    return ("cert", issued, expires, raw)
            else:
                m = find_range(piece.text)
                if m:
                    piece.text = remove_span(piece.text, m.span)
                    return m
        return None

    def _take_location(self, pieces: list[_Piece], from_index: int = 1) -> str | None:
        for piece in pieces:
            if piece.right and piece.line >= 1 and C.is_short_place(piece.text) and not C.find_urls(piece.text):
                loc, piece.text = piece.text, ""
                return loc
            if piece.right and C.is_location(piece.text):
                loc, piece.text = piece.text, ""
                return loc
        texts = [p for p in pieces if p.text]
        for piece in texts[from_index:]:
            # "Austin, TX" / "New York, NY" on their own; "Contoso Payments Austin, TX" is handled below.
            if C.is_location(piece.text) and len(piece.text.split(",")[0].split()) <= 2:
                loc, piece.text = piece.text, ""
                return loc
        # Pasted text: the location may be glued to the end of the subtitle line.
        if len(texts) > from_index:
            target = texts[from_index]
            head, loc = C.split_trailing_location(target.text)
            if loc:
                target.text = head
                return loc
        return None

    @staticmethod
    def _texts(pieces: list[_Piece]) -> list[_Piece]:
        return [p for p in pieces if p.text.strip()]

    def _extra_pieces(self, pieces: list[_Piece], used: int) -> None:
        for p in pieces[used:]:
            self._leftover(p.text)

    def _body_bullets(self, entry: _Entry) -> list[str]:
        return [l.text for l in entry.body]

    def _labels_to_bullets(self, entry: _Entry, skip: set[str]) -> tuple[list[str], list[str]]:
        """Split labels into technologies and other labelled lines (kept as bullets)."""
        tech: list[str] = []
        other: list[str] = []
        for label, value in entry.labels:
            if label.lower() in skip:
                tech += split_top_level(value)
            else:
                other.append(f"{label}: {value}")
        return tech, other

    # -- entry builders --------------------------------------------------------
    def _experience(self, raw: _RawSection, entries: list[_Entry]) -> ExperienceSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "experience")
            location = self._take_location(pieces)
            texts = self._texts(pieces)
            employment = None
            # Only the organisation line ("Northwind Labs · Internship") carries the employment type;
            # a title like "Tutor (part-time)" is kept exactly as written.
            for p in texts[1:2]:
                m = _EMPLOYMENT_SUFFIX.search(p.text)
                if m and m.start() > 0:
                    employment = _EMPLOYMENT_MAP.get(m.group(1).lower())
                    p.text = p.text[: m.start()].strip()
            texts = self._texts(texts)
            title, org = "", ""
            if len(texts) >= 2:
                a, b = texts[0], texts[1]
                swap = (a.italic and b.bold) or (
                    _score(_ORG_WORDS, a.text) > _score(_TITLE_WORDS, a.text)
                    and _score(_TITLE_WORDS, b.text) > _score(_ORG_WORDS, b.text)
                    and not (a.bold and not b.bold)
                )
                title, org = (b.text, a.text) if swap else (a.text, b.text)
                self._extra_pieces(texts, 2)
            elif len(texts) == 1:
                title, org = self._split_title_org(texts[0].text)
            tech, other = self._labels_to_bullets(e, _TECH_LABELS)
            bullets = e.bullets + self._body_bullets(e) + other
            if not title and not org and not bullets:
                continue
            if not org:
                self._warn(f"Experience '{title or '?'}': the company name was not found; please check.")
            items.append(
                ExperienceItem(
                    title=title,
                    organization=org,
                    location=location,
                    employment_type=employment,
                    start=date.start if date else None,
                    end=date.end if date else None,
                    current=date.current if date else False,
                    technologies=tech,
                    bullets=[Bullet(text=b) for b in bullets],
                )
            )
        return ExperienceSection(title=raw.title, items=items)

    @staticmethod
    def _split_title_org(text: str) -> tuple[str, str]:
        for sep in (" at ", " @ ", " — ", " – ", " - ", ", "):
            if sep in text:
                a, b = text.split(sep, 1)
                if sep == ", " and not (_score(_ORG_WORDS, b) or _score(_TITLE_WORDS, a)):
                    continue
                if _score(_ORG_WORDS, a) > _score(_ORG_WORDS, b) and _score(_TITLE_WORDS, b) >= _score(_TITLE_WORDS, a):
                    return b.strip(), a.strip()
                return a.strip(), b.strip()
        return text.strip(), ""

    def _education(self, raw: _RawSection, entries: list[_Entry]) -> EducationSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "education")
            location = self._take_location(pieces)
            texts = self._texts(pieces)
            grade = None
            for t in texts[1:]:
                if _GRADE_RE.search(t.text) and _words(t.text) <= 5:
                    grade = t.text  # "CGPA: 6.8" / "Percentage: 79.5" beside the degree
                    texts.remove(t)
                    break
            degree_text, institution = "", ""
            if len(texts) >= 2:
                a, b = texts[0].text, texts[1].text
                a_inst = _score(_INSTITUTION_WORDS, a) - _score(_DEGREE_WORDS, a)
                b_inst = _score(_INSTITUTION_WORDS, b) - _score(_DEGREE_WORDS, b)
                degree_text, institution = (b, a) if a_inst > b_inst else (a, b)
                self._extra_pieces(texts, 2)
            elif len(texts) == 1:
                t = texts[0].text
                if _score(_DEGREE_WORDS, t) > _score(_INSTITUTION_WORDS, t):
                    degree_text = t
                    self._warn(f"Education '{t}': the school name was not found; please check.")
                else:
                    institution = t
            degree, field_of_study = degree_text or None, None
            if degree_text and ", " in degree_text:
                degree, field_of_study = (s.strip() for s in degree_text.split(", ", 1))
            bullets = list(e.bullets)
            for line in e.body:
                if grade is None and _GRADE_RE.search(line.text) and _words(line.text) <= 8:
                    grade = line.text
                else:
                    bullets.append(line.text)
            _, other = self._labels_to_bullets(e, set())
            if not (degree or institution or bullets):
                continue
            items.append(
                EducationItem(
                    institution=institution,
                    degree=degree,
                    field_of_study=field_of_study,
                    location=location,
                    grade=grade,
                    start=date.start if date else None,
                    end=date.end if date else None,
                    current=date.current if date else False,
                    bullets=[Bullet(text=b) for b in bullets + other],
                )
            )
        return EducationSection(title=raw.title, items=items)

    def _projects(self, raw: _RawSection, entries: list[_Entry]) -> ProjectsSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "projects")
            url = None
            for p in pieces:
                found = C.find_urls(p.text)
                if found and url is None:
                    url = found[0]
                    p.text = p.text.replace(found[0], "").strip(" |·,")
            texts = self._texts(pieces)
            name = texts[0].text.rstrip(" :") if texts else ""
            role = org = None
            if len(texts) >= 2:
                parts = [s.strip() for s in re.split(r"\s+·\s+", texts[1].text) if s.strip()]
                role = parts[0] if parts else None
                org = parts[1] if len(parts) > 1 else None
                for extra in parts[2:]:
                    self._leftover(extra)
                self._extra_pieces(texts, 2)
            tech, other = self._labels_to_bullets(e, _TECH_LABELS)
            bullets = e.bullets + self._body_bullets(e) + other
            if not name and not bullets:
                continue
            items.append(
                ProjectItem(
                    name=name,
                    role=role,
                    organization=org,
                    url=url,
                    start=date.start if date else None,
                    end=date.end if date else None,
                    current=date.current if date else False,
                    technologies=tech,
                    bullets=[Bullet(text=b) for b in bullets],
                )
            )
        return ProjectsSection(title=raw.title, items=items)

    def _certifications(self, raw: _RawSection, entries: list[_Entry]) -> CertificationsSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            found = self._take_date(e, pieces, "certifications")
            issued, expires = (found[1], found[2]) if found else (None, None)
            texts = self._texts(pieces)
            name = texts[0].text if texts else ""
            issuer = texts[1].text if len(texts) > 1 else None
            # Without a date, a description's first lines land in the header ("Name | Issuer",
            # "Gained foundational knowledge of ...", "threats, and risk management."). A plain
            # (not bold) sentence starts the description; following plain pieces continue it.
            description_lines: list[str] = []
            for p in texts[2:]:
                if not p.bold and (description_lines or _words(p.text) >= 4):
                    description_lines.append(p.text)
                else:
                    self._leftover(p.text)
            credential = None
            url = None
            for label, value in e.labels:
                if label.lower() in _CREDENTIAL_LABELS and credential is None:
                    credential = value
                else:
                    self._leftover(f"{label}: {value}")
            for line in e.body:
                urls = C.find_urls(line.text)
                if urls and url is None and _words(line.text) <= 2:
                    url = urls[0]
                else:
                    description_lines.append(line.text)  # "Gained foundational knowledge of ..."
            description_lines += e.bullets
            description = join_wrapped(description_lines) if description_lines else None
            if not name:
                if description:
                    self._leftover(description)
                continue
            items.append(
                CertificationItem(
                    name=name, issuer=issuer, issued=issued, expires=expires, credential_id=credential, url=url,
                    description=description,
                )
            )
        return CertificationsSection(title=raw.title, items=items)

    def _publications(self, raw: _RawSection, entries: list[_Entry]) -> PublicationsSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "publications")
            texts = self._texts(pieces)
            title = texts[0].text if texts else ""
            publisher = texts[1].text if len(texts) > 1 else None
            self._extra_pieces(texts, 2)
            authors = None
            url = None
            description: list[str] = []
            for line in e.body:
                urls = C.find_urls(line.text)
                if urls and url is None and _words(line.text) <= 2:
                    url = urls[0]
                elif authors is None and not description and _AUTHOR_HINT.search(line.text) and _words(line.text) <= 20:
                    authors = line.text
                else:
                    description.append(line.text)
            description += e.bullets
            if not title:
                continue
            items.append(
                PublicationItem(
                    title=title,
                    publisher=publisher,
                    authors=authors,
                    date=(date.end or date.start) if date else None,
                    url=url,
                    description=join_wrapped(description) or None,
                )
            )
        return PublicationsSection(title=raw.title, items=items)

    def _awards(self, raw: _RawSection, entries: list[_Entry]) -> AwardsSection:
        items = []
        for e in entries:
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "awards")
            texts = self._texts(pieces)
            title = texts[0].text if texts else ""
            issuer = texts[1].text if len(texts) > 1 else None
            self._extra_pieces(texts, 2)
            description = join_wrapped([l.text for l in e.body] + e.bullets) or None
            if not title:
                continue
            items.append(AwardItem(title=title, issuer=issuer, date=(date.end or date.start) if date else None, description=description))
        return AwardsSection(title=raw.title, items=items)

    def _custom(self, raw: _RawSection, entries: list[_Entry]) -> CustomSection:
        items = []
        for e in entries:
            # "Label : value" lines (personal details, declarations) are kept whole, one per line.
            # Treating them as title/date/location chopped "D.O.B : 28-04-2006" into a year and
            # took a right-aligned "Signature" for a location, leaving "Place : ..." unplaced.
            key_values = [l for l in e.header if _KEY_VALUE_RE.match(l.text) and "://" not in l.text]
            if key_values:
                e.header = [l for l in e.header if not any(l is k for k in key_values)]
                e.date_idx = None
            kept_lines = [" ".join(s.text.strip() for s in l.segments if s.text.strip()) for l in key_values]
            pieces = self._pieces(e)
            date = self._take_date(e, pieces, "custom")
            location = self._take_location(pieces)
            texts = self._texts(pieces)
            title = texts[0].text if texts else ""
            subtitle = texts[1].text if len(texts) > 1 else None
            self._extra_pieces(texts, 2)
            _, other = self._labels_to_bullets(e, set())
            bullets = kept_lines + e.bullets + self._body_bullets(e) + other
            if not title and not bullets:
                continue
            items.append(
                CustomItem(
                    title=title,
                    subtitle=subtitle,
                    date_text=date.raw.strip() if isinstance(date, DateMatch) else None,
                    location=location,
                    bullets=[Bullet(text=b) for b in bullets],
                )
            )
        return CustomSection(title=raw.title, items=items)


def parse_lines(lines: list[Line], *, wrapped: bool = True) -> tuple[Resume, ParseReport]:
    return ResumeParser(lines, wrapped=wrapped).parse()
