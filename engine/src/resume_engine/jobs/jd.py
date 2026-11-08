"""Job description analysis: requirements (required vs preferred), skills, years, education.

Deterministic. Requirement text is always copied verbatim from the job
description, so every requirement can be shown to the user exactly as written.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..ingest.normalize import normalize_text, strip_bullet
from .skills import find_skills


class _Model(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


RequirementKind = Literal["required", "preferred", "responsibility"]
RequirementCategory = Literal["skill", "experience", "education", "certification", "other"]


class JobRequirement(_Model):
    id: str
    text: str = Field(description="Verbatim from the job description.")
    kind: RequirementKind
    category: RequirementCategory
    skills: list[str] = Field(default_factory=list)
    years: float | None = None


class JobKeyword(_Model):
    skill: str
    term: str = Field(description="How the job description writes it, e.g. 'React.js'.")
    importance: Literal["required", "preferred", "mentioned"]
    count: int
    weight: float


class JobAnalysis(_Model):
    title: str | None = None
    company: str | None = None
    requirements: list[JobRequirement] = Field(default_factory=list)
    keywords: list[JobKeyword] = Field(default_factory=list)
    years_required: float | None = None
    education_level: int | None = Field(default=None, description="1 school, 2 associate, 3 bachelor, 4 master, 5 doctorate")
    education_text: str | None = None
    education_alternative: bool = Field(default=False, description="'or equivalent experience' accepted")
    method: Literal["rules", "llm"] = "rules"
    text: str = ""


# ----------------------------------------------------------------------------- vocabulary

_HEADINGS: dict[str, RequirementKind | None] = {}
for _kind, _names in {
    "required": [
        "requirements", "required qualifications", "minimum qualifications", "basic qualifications", "must have",
        "must haves", "must-haves", "what you need", "what we're looking for", "what we are looking for", "you have",
        "you bring", "what you bring", "qualifications", "skills and experience", "experience and skills", "who you are",
        "key skills", "essential", "essential criteria", "essential skills", "requirements and skills", "about you",
        "your profile", "the ideal candidate", "skills", "required skills", "what you'll need", "what you will need",
    ],
    "preferred": [
        "preferred qualifications", "preferred", "nice to have", "nice to haves", "nice-to-haves", "bonus points", "bonus",
        "pluses", "it's a plus", "desirable", "desired skills", "preferred skills", "extra credit", "ideally",
        "good to have", "bonus skills", "additional qualifications", "desirable criteria",
    ],
    "responsibility": [
        "responsibilities", "what you'll do", "what you will do", "the role", "your role", "key responsibilities",
        "duties", "day to day", "in this role you will", "in this role", "job description", "role description",
        "what you'll be doing", "your responsibilities", "the job", "about the role", "the opportunity",
    ],
    None: [
        "about us", "about the company", "who we are", "benefits", "perks", "what we offer", "compensation", "salary",
        "equal opportunity", "eeo", "how to apply", "location", "why join us", "our values", "perks and benefits",
        "life at", "diversity", "about the team",
    ],
}.items():
    for _name in _names:
        _HEADINGS[_name] = _kind  # type: ignore[assignment]

_PREFERRED_CUE = re.compile(
    r"\b(preferred|nice[- ]to[- ]have|a plus|is a plus|bonus|desirable|ideally|advantageous|good[- ]to[- ]have|would be great)\b",
    re.IGNORECASE,
)
_REQUIRED_CUE = re.compile(r"\b(required|must|essential|minimum|mandatory)\b", re.IGNORECASE)
_REQUIREMENT_HINT = re.compile(
    r"\b(experience|knowledge|proficien\w*|familiar\w*|degree|ability|able to|skills? in|understanding of|expertise|"
    r"background in|track record|fluent|certif\w*|years?)\b",
    re.IGNORECASE,
)
_NUMBER_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen".split())}
_YEARS = re.compile(
    r"(?:(?:at least|minimum(?: of)?|min\.?|over|more than)\s+)?"
    r"(\d{1,2}|" + "|".join(_NUMBER_WORDS) + r")\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b",
    re.IGNORECASE,
)
_DEGREES = [
    (5, re.compile(r"\b(ph\.?\s?d|doctorate|doctoral)\b", re.IGNORECASE)),
    (4, re.compile(r"\b(master'?s|masters|master of|m\.?s\.?c?|mba|m\.?eng|m\.?tech|postgraduate degree)\b", re.IGNORECASE)),
    (3, re.compile(r"\b(bachelor'?s|bachelors|bachelor of|b\.?s\.?c?|b\.?a\.?|b\.?eng|b\.?tech|b\.?e\.|undergraduate degree|bsn|degree|grado)\b", re.IGNORECASE)),
    (2, re.compile(r"\b(associate'?s degree|diploma|hnd)\b", re.IGNORECASE)),
    (1, re.compile(r"\b(high school|secondary school|ged|a-levels?)\b", re.IGNORECASE)),
]
_CERT = re.compile(r"\b(certifi\w+|certified|licen[cs]e[ds]?|registration)\b", re.IGNORECASE)
_EQUIVALENT = re.compile(r"\bor equivalent\b|\bequivalent (?:practical |work )?experience\b", re.IGNORECASE)


def degree_level(text: str) -> int | None:
    for level, regex in _DEGREES:
        if regex.search(text):
            return level
    return None


def _years(text: str) -> float | None:
    if not re.search(r"\bexperience|\bexp\b|\bworking\b|\bbackground\b|\bin (?:a|the)\b", text, re.IGNORECASE):
        return None
    found = []
    for m in _YEARS.finditer(text):
        raw = m.group(1).lower()
        found.append(float(_NUMBER_WORDS.get(raw, raw) if raw in _NUMBER_WORDS else raw))
    return min(found) if found else None


def _heading_kind(line: str) -> tuple[bool, RequirementKind | None]:
    key = re.sub(r"[^a-z' -]", " ", line.lower().replace("&", " and ")).strip()
    key = re.sub(r"\s+", " ", key)
    if key in _HEADINGS:
        return True, _HEADINGS[key]
    for name, kind in _HEADINGS.items():
        if len(name) > 6 and key.startswith(name) and len(key.split()) <= len(name.split()) + 3:
            return True, kind
    return False, None


def _is_heading(raw: str, text: str) -> bool:
    words = text.split()
    return 0 < len(words) <= 8 and (raw.rstrip().endswith(":") or not re.search(r"[.!?]$", text)) and not raw.lstrip()[:1] in "•-*–"


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    return [p.strip() for p in parts if len(p.split()) >= 3]


_COMPANY_PATTERNS = [
    re.compile(r"(?:^|\n)[ \t]*about[ \t]+([A-Z][\w&.'\-]*(?:[ \t]+[A-Z][\w&.'\-]*){0,4})[ \t]*(?::|\n|$)", re.IGNORECASE),
    re.compile(r"(?:^|\n)[ \t]*([A-Z][\w&.'\-]*(?:[ \t]+[A-Z][\w&.'\-]*){0,4})(?:[ \t]*\([^)]*\))?[ \t]+(?:is|are)[ \t]+(?:hiring|looking|seeking|searching)"),
]
_NOT_COMPANIES = {"us", "the role", "you", "the team", "the company", "the job", "the opportunity", "we", "our team"}


def _company(text: str) -> str | None:
    for pattern in _COMPANY_PATTERNS:
        m = pattern.search(text)
        if m:
            name = m.group(1).strip()
            if name.lower() not in _NOT_COMPANIES and name[:1].isupper():
                return name
    return None


def analyze_job(text: str, title: str | None = None, company: str | None = None) -> JobAnalysis:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [normalize_text(l) for l in text.split("\n")]
    requirements: list[JobRequirement] = []
    mode: RequirementKind | None = None
    saw_heading = False
    first_content: str | None = None

    for raw, line in zip(text.split("\n"), lines):
        if not line:
            continue
        stripped, is_bullet = strip_bullet(line)
        if not is_bullet and _is_heading(raw, line):
            is_heading, kind = _heading_kind(line.rstrip(":"))
            if is_heading:
                mode, saw_heading = kind, True
                continue
        if first_content is None:
            first_content = line
        if saw_heading and mode is None:
            continue  # "About us", "Benefits", ...
        candidates = [stripped] if is_bullet else _sentences(stripped)
        for sentence in candidates:
            kind = mode
            if kind is None:
                if _REQUIREMENT_HINT.search(sentence) or _PREFERRED_CUE.search(sentence):
                    kind = "required"
                elif is_bullet:
                    kind = "responsibility"
                else:
                    continue
            if kind != "responsibility":
                if _PREFERRED_CUE.search(sentence):
                    kind = "preferred"
                elif _REQUIRED_CUE.search(sentence):
                    kind = "required"
            skills = list(dict.fromkeys(h.skill for h in find_skills(sentence)))
            years = _years(sentence)
            if years is not None:
                category: RequirementCategory = "experience"
            elif degree_level(sentence) and re.search(r"degree|bachelor|master|ph\.?d|diploma|bsc|msc|mba|ba\b|bs\b", sentence, re.IGNORECASE):
                category = "education"
            elif _CERT.search(sentence) and kind != "responsibility":
                category = "certification"
            elif skills:
                category = "skill"
            else:
                category = "other"
            req_id = hashlib.sha1(f"{len(requirements)}|{sentence}".encode("utf-8")).hexdigest()[:10]
            requirements.append(JobRequirement(id=req_id, text=sentence, kind=kind,
                                               category=category, skills=skills, years=years))

    # Title: the first short line, unless provided (e.g. from the job page's metadata).
    if title is None and first_content and len(first_content.split()) <= 8 and not first_content.endswith("."):
        title = first_content
        requirements = [r for r in requirements if r.text != title]
    if company is None:
        company = _company(text)

    required = [r for r in requirements if r.kind == "required"]
    years_required = min((r.years for r in required if r.years is not None), default=None)
    edu = [(degree_level(r.text), r) for r in requirements if r.category == "education"]
    edu_required = [(lvl, r) for lvl, r in edu if lvl and r.kind == "required"] or [(lvl, r) for lvl, r in edu if lvl]
    education_level = min((lvl for lvl, _ in edu_required), default=None)
    education_text = next((r.text for lvl, r in edu_required if lvl == education_level), None)
    alternative = any(_EQUIVALENT.search(r.text) for _, r in edu_required)

    # Keywords: every skill mentioned, weighted by where and how often.
    counts: Counter[str] = Counter()
    terms: dict[str, Counter[str]] = {}
    for hit in find_skills(text):
        counts[hit.skill] += 1
        terms.setdefault(hit.skill, Counter())[hit.term] += 1
    importance: dict[str, str] = {}
    for r in requirements:
        if r.category == "education":
            continue  # "a degree in statistics" does not make Statistics a required skill
        for s in r.skills:
            rank = {"required": 3, "preferred": 2, "responsibility": 1}[r.kind]
            current = {"required": 3, "preferred": 2, "mentioned": 1}.get(importance.get(s, "mentioned"), 1)
            if rank > current or s not in importance:
                importance[s] = {3: "required", 2: "preferred", 1: "mentioned"}[max(rank, current)]
    base = {"required": 3.0, "preferred": 2.0, "mentioned": 1.0}
    keywords = [
        JobKeyword(skill=s, term=terms[s].most_common(1)[0][0], importance=importance.get(s, "mentioned"),  # type: ignore[arg-type]
                   count=n, weight=round(base[importance.get(s, "mentioned")] * (1 + math.log(n)), 2))
        for s, n in counts.items()
    ]
    keywords.sort(key=lambda k: (-k.weight, k.skill))
    return JobAnalysis(title=title, company=company, requirements=requirements, keywords=keywords,
                       years_required=years_required, education_level=education_level, education_text=education_text,
                       education_alternative=alternative, text=text.strip())
