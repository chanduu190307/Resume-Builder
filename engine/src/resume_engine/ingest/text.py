"""Plain text / pasted text -> lines. Tabs, 3+ spaces and " | " separate segments."""

from __future__ import annotations

import re

from .lines import Line, Segment

_SEGMENT_SPLIT = re.compile(r"\t+| {3,}")


def extract_text_lines(text: str) -> list[Line]:
    lines: list[Line] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        parts = [p for p in _SEGMENT_SPLIT.split(raw) if p.strip()]
        if parts:
            lines.append(Line(segments=[Segment(p) for p in parts]))
    return lines
