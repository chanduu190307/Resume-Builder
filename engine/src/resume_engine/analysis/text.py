"""Language helpers for analysis: action verbs, tense, metrics, weak phrases.

Deliberately simple, transparent rules (no ML): every flag can be explained
by pointing at the words that triggered it.
"""

from __future__ import annotations

import re

# Strong action verbs, base form -> past form (irregular pasts listed explicitly).
_VERBS = """
accelerate achieve administer advise analyze analyse architect assemble assess audit author automate
boost build calculate champion clarify coach collaborate compile complete conceive conduct configure
consolidate construct consult convert coordinate create cultivate cut debug decrease define deliver
deploy design detect develop devise diagnose direct discover document draft drive earn edit educate
eliminate enable engineer enhance establish evaluate execute expand expedite facilitate forecast
formulate found generate grow guide halve handle head identify implement improve increase influence
initiate innovate inspect install integrate interview introduce invent investigate launch lead lower
maintain manage map maximize measure mentor migrate minimize model modernize monitor motivate negotiate
operate optimize orchestrate organize originate outperform overhaul own partner perform pilot pioneer
plan prepare present prioritize process produce program promote propose prototype provide publish
raise rebuild recommend reconcile recruit redesign reduce refactor refine reorganize replace research
resolve restructure revamp review revitalize save scale schedule secure select serve ship simplify
solve spearhead standardize streamline strengthen structure supervise support survey teach test track
train transform translate triple troubleshoot tutor unify upgrade validate win write precept care
fix visualize visualise clean model label curate contribute open-source coauthor co-author volunteer
facilitate present teach host speak represent assist translate summarize consult
"""
_IRREGULAR_PAST = {
    "build": "built", "lead": "led", "drive": "drove", "write": "wrote", "teach": "taught", "win": "won",
    "cut": "cut", "grow": "grew", "found": "founded", "make": "made", "run": "ran", "set": "set",
    "speak": "spoke", "take": "took", "give": "gave", "hold": "held", "begin": "began", "bring": "brought",
    "sell": "sold", "think": "thought", "seek": "sought", "draw": "drew", "own": "owned", "earn": "earned",
}
BASE_VERBS: set[str] = set(_VERBS.split()) | set(_IRREGULAR_PAST)


def _past(verb: str) -> str:
    if verb in _IRREGULAR_PAST:
        return _IRREGULAR_PAST[verb]
    if verb.endswith("e"):
        return verb + "d"
    if re.search(r"[^aeiou]y$", verb):
        return verb[:-1] + "ied"
    if re.search(r"[^aeiou][aeiou][bdgmnpt]$", verb) and verb not in {"develop", "edit", "audit", "pilot", "budget", "target", "visit"}:
        return verb + verb[-1] + "ed"
    return verb + "ed"


PAST_VERBS: set[str] = {_past(v) for v in BASE_VERBS}
THIRD_PERSON: set[str] = {v + ("es" if v.endswith(("s", "sh", "ch", "x", "z")) else "s") for v in BASE_VERBS}

WEAK_PHRASES = [
    "responsible for", "duties included", "duties include", "tasked with", "helped with", "helped to",
    "worked on", "involved in", "participated in", "assisted with", "in charge of", "was part of",
    "handled various", "various tasks",
]
CLICHES = [
    "team player", "hard-working", "hardworking", "hard working", "results-driven", "results driven",
    "results-oriented", "go-getter", "self-starter", "self starter", "detail-oriented", "detail oriented",
    "think outside the box", "synergy", "proven track record", "excellent communication skills",
    "fast learner", "quick learner", "people person", "best of breed", "go above and beyond",
    "dynamic individual", "highly motivated", "passionate about",
]

_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")
_PRONOUN = re.compile(r"\b(I|me|my|mine|myself)\b")
_PASSIVE = re.compile(r"\b(?:was|were|been|being|is|are)\s+(?:\w+ly\s+)?\w+ed\b", re.IGNORECASE)
_YEAR_ONLY = re.compile(r"^(?:19|20)\d\d$")
_NUMBER = re.compile(r"(?<![A-Za-z])[$€£₹]?\d[\d,.]*(?:\s?(?:%|k|m|bn|x|\+))?")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF-]")


def words(text: str) -> list[str]:
    return _WORD.findall(text)


def word_count(text: str) -> int:
    return len(text.split())


def first_word(text: str) -> str:
    found = words(text)
    return found[0].lower() if found else ""


def _is_past_form(w: str) -> bool:
    """Past forms not generated above, e.g. British "modelled", "travelled", or "-ied" verbs."""
    if not w.endswith("ed"):
        return False
    return (
        w[:-2] in BASE_VERBS
        or w[:-1] in BASE_VERBS
        or (len(w) > 4 and w[-3] == w[-4] and w[:-3] in BASE_VERBS)
        or (w.endswith("ied") and w[:-3] + "y" in BASE_VERBS)
    )


def starts_with_action_verb(text: str) -> bool:
    w = first_word(text)
    return w in BASE_VERBS or w in PAST_VERBS or w in THIRD_PERSON or _is_past_form(w)


def verb_tense(text: str) -> str | None:
    """'past', 'present' or None (not a recognised action verb)."""
    w = first_word(text)
    if w in PAST_VERBS or _is_past_form(w):
        return "past"
    if w in BASE_VERBS or w in THIRD_PERSON:
        return "present"
    return None


def is_quantified(text: str) -> bool:
    """True if the text contains a number that is not just a year ("in 2023")."""
    for m in _NUMBER.finditer(text):
        token = m.group(0).strip()
        digits = re.sub(r"[^\d]", "", token)
        if _YEAR_ONLY.match(digits) and token == digits:
            continue
        return True
    return False


def weak_phrases(text: str) -> list[str]:
    lower = text.lower()
    return [p for p in WEAK_PHRASES if p in lower]


def cliches(text: str) -> list[str]:
    lower = text.lower()
    return [c for c in CLICHES if c in lower]


def has_first_person(text: str) -> bool:
    return bool(_PRONOUN.search(text))


def is_passive(text: str) -> bool:
    return bool(_PASSIVE.search(text))


def has_emoji_or_symbols(text: str) -> bool:
    return bool(_EMOJI.search(text))
