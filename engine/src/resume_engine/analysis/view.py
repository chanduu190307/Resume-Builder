"""Convenient read-only views of a resume for analysis (visible content only)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..parse.parser import UNSORTED_TITLE
from ..schema import PartialDate, Resume
from .models import Ref


@dataclass
class BulletView:
    text: str
    ref: Ref
    section_type: str
    item_current: bool


@dataclass
class DatedItem:
    section_type: str
    label: str
    start: PartialDate | None
    end: PartialDate | None
    current: bool
    employment_type: str | None
    ref: Ref
    bullets: list[BulletView]


def visible_sections(resume: Resume):
    return [s for s in resume.sections if s.visible and not (s.type == "custom" and s.title == UNSORTED_TITLE)]


def item_label(section_type: str, item) -> str:
    if section_type == "experience":
        return " at ".join(p for p in (item.title, item.organization) if p) or "an experience entry"
    if section_type == "education":
        return item.institution or item.degree or "an education entry"
    if section_type == "projects":
        return item.name or "a project"
    return getattr(item, "title", "") or getattr(item, "name", "") or "an entry"


def bullets(resume: Resume, types: tuple[str, ...] = ("experience", "projects", "custom", "education")) -> list[BulletView]:
    out = []
    for s in visible_sections(resume):
        if s.type not in types:
            continue
        for item in s.items:
            for b in getattr(item, "bullets", []):
                if b.text.strip():
                    out.append(
                        BulletView(b.text.strip(), Ref(section_id=s.id, item_id=item.id, bullet_id=b.id), s.type, bool(getattr(item, "current", False)))
                    )
    return out


def dated_items(resume: Resume, types: tuple[str, ...] = ("experience", "education", "projects")) -> list[DatedItem]:
    out = []
    for s in visible_sections(resume):
        if s.type not in types:
            continue
        for item in s.items:
            item_bullets = [
                BulletView(b.text.strip(), Ref(section_id=s.id, item_id=item.id, bullet_id=b.id), s.type, bool(item.current))
                for b in item.bullets
                if b.text.strip()
            ]
            out.append(
                DatedItem(
                    s.type, item_label(s.type, item), item.start, item.end, item.current,
                    getattr(item, "employment_type", None), Ref(section_id=s.id, item_id=item.id), item_bullets,
                )
            )
    return out


def month_index(d: PartialDate, *, end: bool = False) -> int:
    """Months since year 0; a year-only start counts from January, a year-only end until December."""
    return d.year * 12 + ((d.month or (12 if end else 1)) - 1)


def today_index(today: date) -> int:
    return today.year * 12 + today.month - 1


def interval(item: DatedItem, today: date) -> tuple[int, int] | None:
    if item.start is None:
        return None
    start = month_index(item.start)
    if item.current:
        stop = today_index(today)
    elif item.end is not None:
        stop = month_index(item.end, end=True)
    else:
        stop = month_index(item.start, end=True)
    return (start, stop) if stop >= start else None


def merged_months(intervals: list[tuple[int, int]]) -> int:
    total, current = 0, None
    for start, stop in sorted(intervals):
        if current is None or start > current[1] + 1:
            if current:
                total += current[1] - current[0] + 1
            current = [start, stop]
        else:
            current[1] = max(current[1], stop)
    if current:
        total += current[1] - current[0] + 1
    return total


def all_text(resume: Resume) -> str:
    parts: list[str] = [resume.contact.full_name or "", resume.contact.headline or ""]

    def walk(value) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for k, v in value.items():
                if k not in ("id", "origin", "kind", "type", "visible", "employment_type"):
                    walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    for s in visible_sections(resume):
        parts.append(s.title)
        walk(s.model_dump()["items"])
    return "\n".join(p for p in parts if p)
