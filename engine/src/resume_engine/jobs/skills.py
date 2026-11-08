"""Find ontology skills in text, with positions (for evidence) and the wording used."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from .ontology import SKILLS, Skill


@dataclass(frozen=True)
class SkillHit:
    skill: str
    """Canonical skill name."""
    term: str
    """The exact text that matched (e.g. "React.js")."""
    start: int
    end: int


def _boundary(term: str) -> tuple[str, str]:
    if len(term) == 1:
        # Single letters (C, R): not inside "C-suite", "R&D", "A/B", "C++", "C#".
        return r"(?<![A-Za-z0-9+#&/.-])", r"(?![A-Za-z0-9+#&/.-])"
    return r"(?<![A-Za-z0-9+#])", r"(?![A-Za-z0-9+#])"


def _alternation(terms: list[str]) -> str:
    parts = []
    for term in sorted(terms, key=len, reverse=True):  # longest first: "React Native" before "React"
        before, after = _boundary(term)
        escaped = re.escape(term).replace(r"\ ", r"\s+")
        parts.append(f"{before}{escaped}{after}")
    return "|".join(parts)


@lru_cache(maxsize=1)
def _matchers() -> tuple[re.Pattern[str], re.Pattern[str], dict[str, str], dict[str, str]]:
    insensitive: dict[str, str] = {}
    sensitive: dict[str, str] = {}
    for skill in SKILLS.values():
        for term in skill.aliases:
            insensitive.setdefault(term.lower(), skill.name)
        for term in skill.case_sensitive:
            sensitive.setdefault(term, skill.name)
    return (
        re.compile(_alternation(list(insensitive)), re.IGNORECASE),
        re.compile(_alternation(list(sensitive))),
        insensitive,
        sensitive,
    )


# Case-sensitive terms that are also English words; at the start of a sentence, followed by
# one of these words, they are being used as words ("Excel in a fast-paced role", "Go above").
_COMMON_WORDS = {"Go", "Swift", "Express", "Excel", "Sketch", "Rust", "Ruby", "Dart", "Helm", "Spark",
                 "Flask", "Jest", "Cypress", "Playwright", "Snowflake", "Epic", "Node", "Spring"}
_VERB_FOLLOWERS = {"in", "at", "on", "to", "the", "a", "an", "with", "beyond", "ahead", "above", "through",
                   "your", "our", "their", "for", "into", "from", "forward", "further", "out", "up"}


def _used_as_word(text: str, start: int, end: int, term: str) -> bool:
    if term not in _COMMON_WORDS:
        return False
    before = text[:start].rstrip()
    sentence_start = not before or before[-1] in ".!?:;\n•-"
    following = re.match(r"\s+([a-z]+)", text[end:])
    return sentence_start and bool(following) and following.group(1) in _VERB_FOLLOWERS


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).replace("’", "'")


def find_skills(text: str) -> list[SkillHit]:
    """All skill mentions, longest match wins, no overlaps, in text order."""
    text = normalize(text)
    insensitive_re, sensitive_re, insensitive, sensitive = _matchers()
    hits: list[SkillHit] = []
    taken: list[tuple[int, int]] = []
    candidates = [(m, insensitive[re.sub(r"\s+", " ", m.group(0)).lower()]) for m in insensitive_re.finditer(text)]
    candidates += [
        (m, sensitive[re.sub(r"\s+", " ", m.group(0))])
        for m in sensitive_re.finditer(text)
        if not _used_as_word(text, m.start(), m.end(), m.group(0))
    ]
    for m, name in sorted(candidates, key=lambda c: (-(c[0].end() - c[0].start()), c[0].start())):
        if any(m.start() < e and s < m.end() for s, e in taken):
            continue
        taken.append((m.start(), m.end()))
        hits.append(SkillHit(name, m.group(0), m.start(), m.end()))
    return sorted(hits, key=lambda h: h.start)


def skill_names(text: str) -> list[str]:
    return list(dict.fromkeys(h.skill for h in find_skills(text)))


def implied_by(skill: str) -> set[str]:
    """Skills that imply ``skill`` (directly or transitively): SQL <- PostgreSQL, Kubernetes <- CKAD."""
    out: set[str] = set()
    frontier = {skill}
    while frontier:
        nxt = {s.name for s in SKILLS.values() if set(s.implies) & frontier} - out
        out |= nxt
        frontier = nxt
    return out


def get(skill: str) -> Skill | None:
    return SKILLS.get(skill)
