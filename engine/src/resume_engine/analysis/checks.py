"""Consistency and content checks. Each issue says what was found and how to fix it.

Gaps, overlaps and personal details are reported as neutral information and
never reduce a score: they are not mistakes, and penalising them would be unfair.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date
from difflib import SequenceMatcher

from ..parse.contact import EMAIL_RE, find_phones
from ..schema import Resume
from . import text as T
from .models import Issue, Ref
from .view import bullets, dated_items, interval, item_label, month_index, today_index, visible_sections

SENSITIVE = re.compile(
    r"\b(date of birth|d\.?o\.?b\.?|age\s*:|marital status|nationality|religion|gender|father'?s name|"
    r"mother'?s name|caste|blood group|passport (?:no|number))\b",
    re.IGNORECASE,
)


def _issue(issues: list[Issue], id: str, severity: str, category: str, message: str,
           suggestion: str | None = None, ref: Ref | None = None, affects_score: bool = True) -> None:
    issues.append(Issue(id=id, severity=severity, category=category, message=message,
                        suggestion=suggestion, ref=ref, affects_score=affects_score))


def _fmt_months(n: int) -> str:
    years, months = divmod(n, 12)
    parts = ([f"{years} year{'s' * (years != 1)}"] if years else []) + ([f"{months} month{'s' * (months != 1)}"] if months else [])
    return " ".join(parts) or "0 months"


def check_contact(resume: Resume, issues: list[Issue]) -> None:
    c = resume.contact
    if not c.full_name.strip():
        _issue(issues, "contact.name_missing", "error", "contact", "Your name is missing.", "Add your full name in Contact details.", Ref(field="contact.full_name"))
    if not c.email:
        _issue(issues, "contact.email_missing", "error", "contact", "No email address.", "Add an email address recruiters can reach you at.", Ref(field="contact.email"))
    elif not EMAIL_RE.fullmatch(c.email.strip()):
        _issue(issues, "contact.email_invalid", "error", "contact", f"'{c.email}' does not look like a valid email address.", "Check it for typos.", Ref(field="contact.email"))
    if not c.phone:
        _issue(issues, "contact.phone_missing", "warning", "contact", "No phone number.", "Most recruiters expect a phone number.", Ref(field="contact.phone"))
    elif not find_phones(c.phone):
        _issue(issues, "contact.phone_invalid", "warning", "contact", f"'{c.phone}' does not look like a complete phone number.", "Include the full number, with country code if applying abroad.", Ref(field="contact.phone"))
    if not c.location:
        _issue(issues, "contact.location_missing", "info", "contact", "No location.", "A city and country (or 'Remote') helps recruiters filter by location.", Ref(field="contact.location"))
    for link in c.links:
        if link.url.strip() and ("." not in link.url or " " in link.url.strip()):
            _issue(issues, "contact.link_invalid", "warning", "contact", f"The link '{link.url}' does not look like a web address.", "Use the full address, e.g. linkedin.com/in/your-name.", Ref(field="contact.links"))


def check_dates(resume: Resume, issues: list[Issue], today: date) -> None:
    items = dated_items(resume)
    now = today_index(today)
    for it in items:
        if it.start and it.end and not it.current and month_index(it.end, end=True) < month_index(it.start):
            _issue(issues, "dates.end_before_start", "error", "consistency", f"{it.label}: the end date is before the start date.", "Correct the dates.", it.ref)
        if it.start and month_index(it.start) > now and it.section_type == "experience":
            _issue(issues, "dates.future_start", "warning", "consistency", f"{it.label}: starts in the future.", "If this is an offer you have accepted, consider saying so explicitly.", it.ref)
        if it.current and it.start is None:
            _issue(issues, "dates.current_no_start", "warning", "consistency", f"{it.label}: marked as current but has no start date.", "Add when you started.", it.ref)
        if it.section_type == "experience" and it.start is None and it.end is None and not it.current:
            _issue(issues, "dates.missing", "warning", "consistency", f"{it.label}: has no dates.", "Add start and end dates (month and year).", it.ref)

    exp = [it for it in items if it.section_type == "experience" and it.start]
    with_month = sum(1 for it in exp if it.start.month)
    if exp and 0 < with_month < len(exp):
        _issue(issues, "dates.precision_mixed", "info", "consistency", "Some roles show month and year, others only the year.",
               "Use month and year for every role so dates read consistently.")

    # Gaps and overlaps between jobs: information only, never penalised.
    jobs = sorted(
        ((iv, it) for it in exp if it.employment_type not in ("internship", "volunteer") and (iv := interval(it, today))),
        key=lambda pair: pair[0][0],
    )
    for (a_iv, a), (b_iv, b) in zip(jobs, jobs[1:]):
        gap = b_iv[0] - a_iv[1] - 1
        if gap >= 6:
            _issue(issues, "dates.gap", "info", "timeline", f"There is a gap of about {_fmt_months(gap)} between {a.label} and {b.label}.",
                   "Gaps are common and fine. You might add a short line about what you did (study, caregiving, travel, freelancing) if you are comfortable doing so.",
                   b.ref, affects_score=False)
    for i, (a_iv, a) in enumerate(jobs):
        for b_iv, b in jobs[i + 1:]:
            overlap = min(a_iv[1], b_iv[1]) - max(a_iv[0], b_iv[0]) + 1
            types = {a.employment_type, b.employment_type}
            if overlap >= 3 and types <= {None, "full_time"}:
                _issue(issues, "dates.overlap", "info", "timeline", f"{a.label} and {b.label} overlap by about {_fmt_months(overlap)}.",
                       "That is fine if you held both roles at once; otherwise check the dates.", b.ref, affects_score=False)


def check_bullets(resume: Resume, issues: list[Issue]) -> None:
    all_bullets = bullets(resume)
    for b in all_bullets:
        n = T.word_count(b.text)
        if n > 40:
            _issue(issues, "bullets.too_long", "warning", "clarity", f"A bullet has {n} words: “{b.text[:70]}…”", "Aim for one or two lines (under about 35 words). Split it or cut detail.", b.ref)
        elif n < 4 and b.section_type in ("experience", "projects"):
            _issue(issues, "bullets.too_short", "info", "clarity", f"A very short bullet: “{b.text}”", "Say what you did and what it achieved.", b.ref)
        for phrase in T.weak_phrases(b.text):
            _issue(issues, "bullets.weak_phrase", "warning", "impact", f"“{phrase}” describes duties rather than results: “{b.text[:70]}”",
                   "Start with what you did, e.g. 'Managed…', 'Built…', and add the outcome.", b.ref)
        if T.has_first_person(b.text):
            _issue(issues, "bullets.first_person", "warning", "clarity", f"A bullet uses 'I' or 'my': “{b.text[:70]}”", "Resume bullets usually omit the pronoun: 'Led…' instead of 'I led…'.", b.ref)
        if T.is_passive(b.text):
            _issue(issues, "bullets.passive", "info", "clarity", f"Passive wording: “{b.text[:70]}”", "Active voice is clearer: say who did what.", b.ref)
        if b.section_type in ("experience", "projects") and not T.starts_with_action_verb(b.text) and not T.weak_phrases(b.text):
            _issue(issues, "bullets.no_action_verb", "info", "impact", f"Doesn't start with an action verb: “{b.text[:70]}”", "Starting with a verb (Built, Reduced, Led…) makes the contribution clear.", b.ref)

    # Duplicates (identical or nearly identical bullets anywhere).
    seen: list[tuple[str, object]] = []
    for b in all_bullets:
        key = re.sub(r"\W+", " ", b.text.lower()).strip()
        for other_key, _ in seen:
            if key == other_key or (len(key) > 30 and SequenceMatcher(None, key, other_key).ratio() > 0.92):
                _issue(issues, "bullets.duplicate", "warning", "consistency", f"This bullet repeats another one: “{b.text[:70]}”", "Remove or reword the repeat.", b.ref)
                break
        seen.append((key, b))

    # Same opening verb used many times.
    starts = Counter(T.first_word(b.text) for b in all_bullets if T.starts_with_action_verb(b.text))
    for verb, count in starts.items():
        if count >= 4:
            _issue(issues, "bullets.repeated_start", "info", "clarity", f"{count} bullets start with “{verb.capitalize()}”.", "Vary your verbs so each achievement stands out.")


def check_tense(resume: Resume, issues: list[Issue]) -> tuple[int, int]:
    """Returns (roles checked, roles with consistent, appropriate tense)."""
    checked = consistent = 0
    for it in dated_items(resume, ("experience",)):
        tenses = [t for b in it.bullets if (t := T.verb_tense(b.text))]
        if len(tenses) < 2:
            continue
        checked += 1
        kinds = set(tenses)
        if it.current:
            # Present tense for ongoing duties plus past tense for finished achievements is normal in a current role.
            consistent += 1
        elif len(kinds) > 1:
            _issue(issues, "bullets.tense_mixed", "warning", "consistency", f"{it.label}: bullets mix past and present tense.",
                   "Use present tense for your current role and past tense for earlier roles.", it.ref)
        elif not it.current and kinds == {"present"}:
            _issue(issues, "bullets.past_role_present", "warning", "consistency", f"{it.label}: an earlier role is written in the present tense.",
                   "Use past tense for roles you have left (e.g. 'Led', 'Built').", it.ref)
        else:
            consistent += 1
    return checked, consistent


def check_sections(resume: Resume, issues: list[Issue], level: str) -> None:
    sections = visible_sections(resume)
    types = {s.type for s in sections if any(True for _ in s.items)}
    summary_items = [i for s in sections if s.type == "summary" for i in s.items if i.text.strip()]
    if not summary_items:
        _issue(issues, "summary.missing", "warning", "completeness", "No summary.", "Add 2-4 sentences about who you are and what you are looking for.")
    for item in summary_items:
        n = T.word_count(item.text)
        if n > 100:
            _issue(issues, "summary.too_long", "warning", "clarity", f"Your summary has {n} words.", "Keep it to about 30-90 words; recruiters skim.")
        elif n < 15:
            _issue(issues, "summary.too_short", "info", "clarity", f"Your summary has only {n} words.", "Two or three full sentences work best.")
    if "skills" not in types:
        _issue(issues, "skills.missing", "warning", "completeness", "No skills section.", "List the tools, technologies and skills you have actually used.")
    if "education" not in types:
        _issue(issues, "education.missing", "warning" if level == "early" else "info", "completeness", "No education section.", "Add your highest qualification.")
    if "experience" not in types and not (level == "early" and "projects" in types):
        _issue(issues, "experience.missing", "warning", "completeness", "No experience section.",
               "Add jobs, internships or volunteering. Early in your career, projects count too.")

    for s in sections:
        if s.type == "experience":
            for item in s.items:
                filled = [b for b in item.bullets if b.text.strip()]
                if not filled:
                    _issue(issues, "role.no_bullets", "warning", "impact", f"{item_label('experience', item)}: no bullet points.",
                           "Add 2-5 bullets on what you did and achieved.", Ref(section_id=s.id, item_id=item.id))
                elif len(filled) > 8:
                    _issue(issues, "role.too_many_bullets", "info", "length", f"{item_label('experience', item)}: {len(filled)} bullets.",
                           "Keep the 4-6 most relevant; older roles need fewer.", Ref(section_id=s.id, item_id=item.id))

    # Skills: duplicates and volume.
    skills = [(sk, s, g) for s in sections if s.type == "skills" for g in s.items for sk in g.skills]
    counts = Counter(sk.lower().strip() for sk, _, _ in skills)
    for name, count in counts.items():
        if count > 1:
            _issue(issues, "skills.duplicate", "warning", "consistency", f"“{name}” is listed {count} times in your skills.", "List each skill once.")
    if len(skills) > 40:
        _issue(issues, "skills.too_many", "info", "skills", f"{len(skills)} skills listed.", "A focused list of your strongest 15-30 skills is more convincing.")
    groups = [g for s in sections if s.type == "skills" for g in s.items]
    if len(skills) > 12 and len([g for g in groups if g.name]) < 2:
        _issue(issues, "skills.ungrouped", "info", "skills", "A long, ungrouped skills list.", "Group skills (e.g. Languages, Frameworks, Tools) so they are easy to scan.")


def check_language(resume: Resume, issues: list[Issue], full_text: str) -> None:
    found = defaultdict(int)
    for phrase in T.cliches(full_text):
        found[phrase] += 1
    for phrase in found:
        _issue(issues, "text.cliche", "info", "clarity", f"“{phrase}” is a common cliché that recruiters skip over.",
               "Show it with evidence instead (a result or example).")
    if T.has_emoji_or_symbols(full_text):
        _issue(issues, "text.symbols", "warning", "parsing", "Your resume contains emoji or decorative symbols.",
               "Applicant tracking systems may drop or garble them; use plain text.")
    for m in SENSITIVE.finditer(full_text):
        _issue(issues, "personal.sensitive", "info", "personal", f"Your resume includes “{m.group(0)}”.",
               "Many employers advise leaving out personal details like this; they are rarely required and can introduce bias.",
               affects_score=False)
        break
