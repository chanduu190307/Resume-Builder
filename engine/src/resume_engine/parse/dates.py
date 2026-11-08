"""Find and parse dates and date ranges inside resume header text.

Supported forms: "Jun 2025", "June 2025", "Jun. 2025", "06/2025", "2025-06",
"2025", "Summer 2021", "Present"/"Current"/"Now", ranges joined by
"–", "—", "-", "to", "until", plus certification forms like "Expires May 2025".
Only 4-digit years 1950-2099 count, so "3M requests" or "2 terms" never match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..schema import PartialDate

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
SEASONS = ("spring", "summer", "fall", "autumn", "winter")

_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
_YEAR = r"(?:19[5-9]\d|20\d\d)"
_SEASON = r"(?:spring|summer|fall|autumn|winter)"
_SINGLE = (
    rf"(?:{_MONTH}\s*,?\s*{_YEAR}"
    rf"|{_SEASON}\s+{_YEAR}"
    rf"|(?:0?[1-9]|1[0-2])\s*[/.]\s*{_YEAR}"
    rf"|{_YEAR}\s*[/.-]\s*(?:0[1-9]|1[0-2])(?!\d)"
    rf"|{_YEAR})"
)
_PRESENT = r"(?:present|current(?:ly)?|now|ongoing|today|till\s+date|to\s+date|date)"
_SEP = r"\s*(?:–|—|-|‒|―|\bto\b|\buntil\b|\btill\b)\s*"

RANGE_RE = re.compile(rf"(?<![\w/])({_SINGLE}){_SEP}({_SINGLE}|{_PRESENT})(?![\w/])", re.IGNORECASE)
SINCE_RE = re.compile(rf"(?<![\w/])(?:since|from)\s+({_SINGLE})(?![\w/])", re.IGNORECASE)
SINGLE_RE = re.compile(rf"(?<![\w/])({_SINGLE})(?![\w/])", re.IGNORECASE)
EXPIRES_RE = re.compile(
    rf"(?:(?<![\w/])({_SINGLE}){_SEP})?(?:expires|expiry|exp\.?|valid\s+(?:until|through|thru))\s*:?\s*({_SINGLE})(?![\w/])",
    re.IGNORECASE,
)
_PRESENT_RE = re.compile(rf"^{_PRESENT}$", re.IGNORECASE)


def parse_single(text: str) -> PartialDate | None:
    t = text.strip().lower().rstrip(".")
    if m := re.fullmatch(rf"({_MONTH})\s*,?\s*({_YEAR})", t, re.IGNORECASE):
        key = m.group(1).rstrip(".").lower()
        return PartialDate(year=int(m.group(2)), month=MONTHS.get(key) or MONTHS[key[:3]])
    if m := re.fullmatch(rf"{_SEASON}\s+({_YEAR})", t):
        return PartialDate(year=int(m.group(1)))
    if m := re.fullmatch(rf"(0?[1-9]|1[0-2])\s*[/.]\s*({_YEAR})", t):
        return PartialDate(year=int(m.group(2)), month=int(m.group(1)))
    if m := re.fullmatch(rf"({_YEAR})\s*[/.-]\s*(0[1-9]|1[0-2])", t):
        return PartialDate(year=int(m.group(1)), month=int(m.group(2)))
    if m := re.fullmatch(_YEAR, t):
        return PartialDate(year=int(m.group(0)))
    return None


@dataclass
class DateMatch:
    start: PartialDate | None
    end: PartialDate | None
    current: bool
    span: tuple[int, int]
    raw: str


def find_range(text: str) -> DateMatch | None:
    """Find the last date range (or single date) in ``text``."""
    matches = list(RANGE_RE.finditer(text))
    if matches:
        m = matches[-1]
        start = parse_single(m.group(1))
        end_text = m.group(2)
        current = bool(_PRESENT_RE.match(end_text.strip()))
        end = None if current else parse_single(end_text)
        return DateMatch(start, end, current, m.span(), m.group(0))
    if m := SINCE_RE.search(text):
        return DateMatch(parse_single(m.group(1)), None, True, m.span(), m.group(0))
    matches = list(SINGLE_RE.finditer(text))
    if matches:
        m = matches[-1]
        return DateMatch(None, parse_single(m.group(1)), False, m.span(), m.group(0))
    return None


def find_cert_dates(text: str) -> tuple[PartialDate | None, PartialDate | None, tuple[int, int], str] | None:
    """Certification dates: "May 2022 – Expires May 2025", "Expires Sep 2026", "2022"."""
    if m := EXPIRES_RE.search(text):
        issued = parse_single(m.group(1)) if m.group(1) else None
        return issued, parse_single(m.group(2)), m.span(), m.group(0)
    matches = list(SINGLE_RE.finditer(text))
    if matches:
        m = matches[-1]
        return parse_single(m.group(1)), None, m.span(), m.group(0)
    return None


def remove_span(text: str, span: tuple[int, int]) -> str:
    """Remove a matched span and tidy the separators left behind."""
    rest = (text[: span[0]] + " " + text[span[1]:]).strip()
    rest = re.sub(r"\(\s*\)", "", rest)
    rest = re.sub(r"\s{2,}", " ", rest)
    rest = rest.strip(" ,|·•–—-:;")
    # Drop only *dangling* brackets left by the removal; keep balanced ones like "(PCMC)".
    while rest.endswith("(") or (rest.endswith(")") and rest.count(")") > rest.count("(")):
        rest = rest[:-1].rstrip(" ,|·•–—-:;")
    while rest.startswith(")") or (rest.startswith("(") and rest.count("(") > rest.count(")")):
        rest = rest[1:].lstrip(" ,|·•–—-:;")
    return rest.strip()
