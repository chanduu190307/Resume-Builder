"""Field-level comparison of an expected resume against an actual one.

This is the measuring stick for extraction accuracy (Phase 2 onward): a parser's
output is compared with the hand-labelled fixture it was produced from.

Scoring rules
-------------
* Every non-empty expected field is one scored field.
* A field the expected resume leaves empty but the actual resume fills in is
  scored as an error (the parser invented or misplaced data).
* Fields empty on both sides are not scored.
* Items (jobs, degrees, ...) are aligned by similarity of their key fields,
  so order differences are not penalised.
* Skills are compared as a flat set across all skill groups (grouping is a
  presentation choice); each expected skill is one scored field.
* IDs, ``origin``, ``visible``, section titles and ``meta`` are ignored.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Callable

from ..schema import Resume

ITEM_MATCH_THRESHOLD = 0.6
BULLET_MATCH_THRESHOLD = 0.9

_EDGE_PUNCT = " .,;:-–—•·*"


def norm_text(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).casefold()
    text = re.sub(r"\s+", " ", text)
    return text.strip(_EDGE_PUNCT)


def norm_phone(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def norm_url(value: Any) -> str:
    text = norm_text(value)
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    return text.rstrip("/")


def similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


@dataclass
class FieldResult:
    path: str
    expected: Any
    actual: Any
    correct: bool


@dataclass
class ComparisonReport:
    fields: list[FieldResult] = field(default_factory=list)
    missing_items: list[str] = field(default_factory=list)
    extra_items: list[str] = field(default_factory=list)

    @property
    def scored(self) -> int:
        return len(self.fields)

    @property
    def correct(self) -> int:
        return sum(f.correct for f in self.fields)

    @property
    def accuracy(self) -> float:
        return self.correct / self.scored if self.scored else 1.0

    @property
    def mismatches(self) -> list[FieldResult]:
        return [f for f in self.fields if not f.correct]

    def summary(self) -> str:
        lines = [f"field accuracy: {self.accuracy:.1%} ({self.correct}/{self.scored})"]
        lines += [f"  MISMATCH {m.path}: expected={m.expected!r} actual={m.actual!r}" for m in self.mismatches]
        lines += [f"  MISSING  {p}" for p in self.missing_items]
        lines += [f"  EXTRA    {p}" for p in self.extra_items]
        return "\n".join(lines)


# --------------------------------------------------------------------------- helpers

def _score(report: ComparisonReport, path: str, expected: Any, actual: Any,
           normalise: Callable[[Any], str] = norm_text) -> None:
    exp_n, act_n = normalise(expected), normalise(actual)
    if not exp_n and not act_n:
        return
    report.fields.append(FieldResult(path, expected, actual, exp_n == act_n))


def _score_date(report: ComparisonReport, path: str, expected: Any, actual: Any) -> None:
    exp = expected.model_dump() if expected is not None else None
    act = actual.model_dump() if actual is not None else None
    if exp is None and act is None:
        return
    report.fields.append(FieldResult(path, exp, act, exp == act))


def _align(expected: list[Any], actual: list[Any], key: Callable[[Any], str],
           threshold: float) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Greedy one-to-one alignment by descending similarity of ``key``."""
    candidates = sorted(
        ((similarity(key(e), key(a)), i, j) for i, e in enumerate(expected) for j, a in enumerate(actual)),
        reverse=True,
    )
    used_e: set[int] = set()
    used_a: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for score, i, j in candidates:
        if score < threshold or i in used_e or j in used_a:
            continue
        pairs.append((i, j))
        used_e.add(i)
        used_a.add(j)
    missing = [i for i in range(len(expected)) if i not in used_e]
    extra = [j for j in range(len(actual)) if j not in used_a]
    return sorted(pairs), missing, extra


def _score_string_set(report: ComparisonReport, path: str, expected: list[str], actual: list[str]) -> None:
    act = {norm_text(s) for s in actual}
    exp = {norm_text(s) for s in expected}
    for s in expected:
        report.fields.append(FieldResult(f"{path}[{s}]", s, s if norm_text(s) in act else None, norm_text(s) in act))
    for s in actual:
        if norm_text(s) not in exp:
            report.fields.append(FieldResult(f"{path}[{s}]", None, s, False))


def _score_bullets(report: ComparisonReport, path: str, expected: list[Any], actual: list[Any]) -> None:
    pairs, missing, extra = _align(expected, actual, lambda b: norm_text(b.text), BULLET_MATCH_THRESHOLD)
    for i, j in pairs:
        report.fields.append(FieldResult(f"{path}[{i}]", expected[i].text, actual[j].text, True))
    for i in missing:
        report.fields.append(FieldResult(f"{path}[{i}]", expected[i].text, None, False))
    for j in extra:
        report.fields.append(FieldResult(f"{path}[+{j}]", None, actual[j].text, False))


# Per section type: how to identify an item, and which fields to score.
_ITEM_KEYS: dict[str, Callable[[Any], str]] = {
    "summary": lambda it: norm_text(it.text)[:200],
    "experience": lambda it: f"{norm_text(it.title)} | {norm_text(it.organization)}",
    "education": lambda it: f"{norm_text(it.institution)} | {norm_text(it.degree)}",
    "projects": lambda it: norm_text(it.name),
    "certifications": lambda it: norm_text(it.name),
    "publications": lambda it: norm_text(it.title),
    "languages": lambda it: norm_text(it.language),
    "awards": lambda it: norm_text(it.title),
    "custom": lambda it: f"{norm_text(it.title)} | {norm_text(it.subtitle)}",
}

_TEXT_FIELDS: dict[str, tuple[str, ...]] = {
    "summary": ("kind", "text"),
    "experience": ("title", "organization", "location", "employment_type"),
    "education": ("institution", "degree", "field_of_study", "location", "grade"),
    "projects": ("name", "role", "organization"),
    "certifications": ("name", "issuer", "credential_id", "description"),
    "publications": ("title", "publisher", "authors", "description"),
    "languages": ("language", "proficiency"),
    "awards": ("title", "issuer", "description"),
    "custom": ("title", "subtitle", "date_text", "location"),
}
_URL_FIELDS = ("url",)
_DATE_FIELDS = ("start", "end", "issued", "expires", "date")
_LIST_FIELDS = ("technologies",)


def _items_by_type(resume: Resume) -> dict[str, list[Any]]:
    grouped: dict[str, list[Any]] = {}
    for section in resume.sections:
        grouped.setdefault(section.type, []).extend(section.items)
    return grouped


def _score_item(report: ComparisonReport, kind: str, path: str, exp: Any, act: Any) -> None:
    for name in _TEXT_FIELDS[kind]:
        _score(report, f"{path}.{name}", getattr(exp, name, None), getattr(act, name, None))
    for name in _URL_FIELDS:
        if hasattr(exp, name):
            _score(report, f"{path}.{name}", getattr(exp, name), getattr(act, name), norm_url)
    for name in _DATE_FIELDS:
        if hasattr(exp, name):
            _score_date(report, f"{path}.{name}", getattr(exp, name), getattr(act, name))
    if hasattr(exp, "current") and (exp.current or act.current):
        report.fields.append(FieldResult(f"{path}.current", exp.current, act.current, exp.current == act.current))
    for name in _LIST_FIELDS:
        if hasattr(exp, name):
            _score_string_set(report, f"{path}.{name}", getattr(exp, name), getattr(act, name))
    if hasattr(exp, "bullets"):
        _score_bullets(report, f"{path}.bullets", exp.bullets, act.bullets)


# --------------------------------------------------------------------------- entry point

def compare_resumes(expected: Resume, actual: Resume) -> ComparisonReport:
    report = ComparisonReport()

    ec, ac = expected.contact, actual.contact
    for name in ("full_name", "headline", "email", "location"):
        _score(report, f"contact.{name}", getattr(ec, name), getattr(ac, name))
    _score(report, "contact.phone", ec.phone, ac.phone, norm_phone)
    _score_string_set(
        report, "contact.links", [norm_url(l.url) for l in ec.links], [norm_url(l.url) for l in ac.links]
    )

    exp_items, act_items = _items_by_type(expected), _items_by_type(actual)

    _score_string_set(
        report,
        "skills",
        [s for g in exp_items.get("skills", []) for s in g.skills],
        [s for g in act_items.get("skills", []) for s in g.skills],
    )

    for kind, key in _ITEM_KEYS.items():
        exp_list, act_list = exp_items.get(kind, []), act_items.get(kind, [])
        pairs, missing, extra = _align(exp_list, act_list, key, ITEM_MATCH_THRESHOLD)
        for i, j in pairs:
            _score_item(report, kind, f"{kind}[{i}]", exp_list[i], act_list[j])
        report.missing_items += [f"{kind}[{i}] {key(exp_list[i])!r}" for i in missing]
        report.extra_items += [f"{kind}[+{j}] {key(act_list[j])!r}" for j in extra]
        # A missing item costs every field it would have contributed.
        for i in missing:
            empty = _empty_like(exp_list[i])
            _score_item(report, kind, f"{kind}[{i}]", exp_list[i], empty)

    return report


def _empty_like(item: Any) -> Any:
    """An item of the same type with every scored field blank."""
    return type(item).model_construct(
        **{name: (False if name == "current" else [] if isinstance(value, list) else None)
           for name, value in item}
    )
