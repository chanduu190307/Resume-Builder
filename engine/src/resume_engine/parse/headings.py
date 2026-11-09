"""Recognise section headings and map them to section types."""

from __future__ import annotations

import re

from ..ingest import Line

# Normalised heading text -> section type. "objective" headings become summary sections.
HEADINGS: dict[str, str] = {}

_GROUPS = {
    "summary": [
        "summary", "professional summary", "profile", "professional profile", "about", "about me",
        "career summary", "executive summary", "research summary", "overview", "personal statement",
        "career objective", "objective", "professional objective", "career profile", "summary of qualifications",
    ],
    "experience": [
        "experience", "work experience", "professional experience", "employment", "employment history",
        "work history", "career history", "relevant experience", "research experience", "clinical experience",
        "internships", "internship", "internship experience", "volunteer experience", "volunteering",
        "teaching experience", "leadership experience", "professional background", "industry experience",
        "work", "positions", "experience and internships",
    ],
    "education": [
        "education", "academic background", "academics", "education and training", "qualifications",
        "academic qualifications", "educational background", "education and qualifications", "academic history",
    ],
    "projects": [
        "projects", "personal projects", "academic projects", "selected projects", "data projects",
        "key projects", "side projects", "project experience", "technical projects", "portfolio",
    ],
    "skills": [
        "skills", "technical skills", "core skills", "key skills", "core competencies", "competencies",
        "areas of expertise", "expertise", "skills and tools", "tools and technologies", "technologies",
        "clinical skills", "technical proficiencies", "skills and abilities", "skill set", "skillset",
        "professional skills", "computer skills", "it skills", "skills and interests", "tools",
    ],
    "certifications": [
        "certifications", "certificates", "certification", "licenses", "licences", "licenses and certifications",
        "licences and certifications", "certifications and licenses", "professional certifications",
        "credentials", "training and certifications", "certifications and training", "courses and certifications",
    ],
    "publications": [
        "publications", "papers", "research publications", "selected publications", "articles",
        "publications and presentations", "conference papers",
    ],
    "languages": ["languages", "language skills", "language proficiency", "spoken languages"],
    "awards": [
        "awards", "honors", "honours", "awards and honors", "awards and honours", "honors and awards",
        "honours and awards", "achievements", "accomplishments", "recognition", "scholarships",
        "awards and achievements", "achievements and awards",
    ],
    "custom": [
        "extracurricular activities", "extracurriculars", "extra-curricular activities", "activities",
        "interests", "hobbies", "hobbies and interests", "leadership", "leadership and activities",
        "references", "additional information", "affiliations", "memberships", "professional memberships",
        "conferences", "courses", "relevant coursework", "coursework", "volunteer work", "community service",
        "training", "workshops", "personal details", "personal information", "declaration",
    ],
}
for _type, _names in _GROUPS.items():
    for _name in _names:
        HEADINGS[_name] = _type


def normalize_heading(text: str) -> str:
    t = text.lower().replace("&", " and ").replace("/", " and ")
    t = re.sub(r"[^a-z\- ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def heading_type(line: Line) -> str | None:
    """Section type if ``line`` is a section heading, else None."""
    if line.bullet or len(line.segments) > 1:
        return None
    raw = line.text.strip()
    if not raw or len(raw) > 60 or raw.endswith((".", ",", ";")) or "@" in raw:
        return None
    key = normalize_heading(raw.rstrip(":"))
    if key in HEADINGS:
        return HEADINGS[key]
    # Unknown headings count only when they look like one: short, ALL CAPS, no digits.
    letters = [c for c in raw if c.isalpha()]
    if (
        4 <= len(letters)
        and len(raw.split()) <= 4
        and all(c.isupper() for c in letters)
        and not any(c.isdigit() for c in raw)
        and not any(c in raw.rstrip(":") for c in ",|:;()")
    ):
        return "custom"
    return None


def is_known_heading(line: Line) -> bool:
    """A heading from the known list ("Education", "WORK EXPERIENCE:"), as opposed to an unknown
    ALL-CAPS line that only looks like one."""
    kind = heading_type(line)
    return kind is not None and normalize_heading(line.text.strip().rstrip(":")) in HEADINGS


SMALL_WORDS = {"and", "of", "the", "in", "for", "a", "an", "to", "on", "at", "or", "&"}


def display_title(raw: str) -> str:
    """"PROFESSIONAL EXPERIENCE" -> "Professional Experience"; mixed case is kept as typed."""
    text = raw.strip().rstrip(":").strip()
    letters = [c for c in text if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        words = text.lower().split()
        return " ".join(w if (i > 0 and w in SMALL_WORDS) else w[:1].upper() + w[1:] for i, w in enumerate(words))
    return text
