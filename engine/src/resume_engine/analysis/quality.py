"""Resume Quality Score: a fixed, weighted rubric (100 points).

  Completeness 20 | Impact 25 | Clarity 20 | Consistency 15 | Skills 10 | Length & focus 10

Every criterion measures something countable and explains the count. Targets
differ only where career stage genuinely changes expectations (early career:
fewer quantified results, shorter resumes, projects count as experience).
"""

from __future__ import annotations

import re

from ..parse.contact import EMAIL_RE
from ..schema import Resume
from . import text as T
from .models import Category, Criterion, Issue, Ref, Score, band_for, status_for
from .view import BulletView, bullets, dated_items, visible_sections


def _crit(id: str, label: str, points: float, max_points: float, explanation: str,
          tips: list[str] | None = None, refs: list[Ref] | None = None) -> Criterion:
    points = round(max(0.0, min(points, max_points)), 1)
    return Criterion(id=id, label=label, points=points, max_points=max_points,
                     status=status_for(points, max_points), explanation=explanation,
                     tips=tips or [], refs=(refs or [])[:10])


def _cat(id: str, label: str, criteria: list[Criterion]) -> Category:
    return Category(id=id, label=label, score=round(sum(c.points for c in criteria), 1),
                    max_score=sum(c.max_points for c in criteria), criteria=criteria)


_STEM_WORD = re.compile(r"[a-z0-9+#.]+")


def skill_mentioned(skill: str, text: str) -> bool:
    """A skill counts as mentioned if the phrase appears, or every significant word's stem does
    ("Ventilator management" matches "ventilated ... managed")."""
    lower = text.lower()
    if skill.lower() in lower:
        return True
    words = [w for w in _STEM_WORD.findall(skill.lower()) if len(w) >= 4]
    if not words:
        return False
    tokens = _STEM_WORD.findall(lower)
    return all(any(t.startswith(w[:5]) for t in tokens) for w in words)


def _pct(n: int, d: int) -> str:
    return f"{n} of {d} ({round(100 * n / d)}%)" if d else "none"


def score_quality(resume: Resume, issues: list[Issue], level: str, tense: tuple[int, int], full_text: str) -> Score:
    sections = visible_sections(resume)
    types = {s.type for s in sections if s.items}
    c = resume.contact
    work_bullets: list[BulletView] = bullets(resume, ("experience", "projects"))
    all_bullets = bullets(resume)
    early = level == "early"

    # ---------------------------------------------------------------- completeness (20)
    contact_points = (2 if c.full_name.strip() else 0) + (2 if c.email and EMAIL_RE.fullmatch(c.email.strip()) else 0) \
        + (1 if c.phone else 0) + (1 if c.location else 0)
    missing_contact = [n for n, ok in (("name", c.full_name.strip()), ("valid email", c.email and EMAIL_RE.fullmatch(c.email.strip())),
                                         ("phone", c.phone), ("location", c.location)) if not ok]
    has_summary = any(i.text.strip() for s in sections if s.type == "summary" for i in s.items)
    if early:
        core = [("education", 3, "education" in types), ("experience, internships or projects", 3, bool({"experience", "projects"} & types)),
                ("skills", 1, "skills" in types), ("summary", 1, has_summary)]
    else:
        core = [("experience", 3, "experience" in types), ("education", 2, "education" in types),
                ("skills", 2, "skills" in types), ("summary", 1, has_summary)]
    core_points = sum(p for _, p, ok in core if ok)
    missing_core = [n for n, _, ok in core if not ok]
    # Projects often have no dates, so only jobs and education are expected to be dated.
    dated = dated_items(resume, ("experience", "education"))
    with_dates = [it for it in dated if it.start or it.end or it.current]
    completeness = _cat("completeness", "Completeness", [
        _crit("contact", "Contact details", contact_points, 6,
              "All key contact details are present." if not missing_contact else f"Missing: {', '.join(missing_contact)}.",
              [f"Add your {m}." for m in missing_contact]),
        _crit("core_sections", "Core sections", core_points, 8,
              ("Has every core section expected " + ("early in a career." if early else "for an experienced candidate."))
              if not missing_core else f"Missing: {', '.join(missing_core)}.",
              [f"Add a {m} section." for m in missing_core]),
        _crit("dates", "Dated entries", 6 * (len(with_dates) / len(dated)) if dated else 0, 6,
              f"Entries with dates: {_pct(len(with_dates), len(dated))}.",
              ["Add start and end dates (month and year) to every job, degree and project."] if len(with_dates) < len(dated) else [],
              [it.ref for it in dated if it not in with_dates]),
    ])

    # ---------------------------------------------------------------- impact (25)
    n = len(work_bullets)
    quantified = [b for b in work_bullets if T.is_quantified(b.text)]
    target_q = 0.3 if early else 0.5
    verbs = [b for b in work_bullets if T.starts_with_action_verb(b.text)]
    weak = [b for b in all_bullets if T.weak_phrases(b.text)]
    impact = _cat("impact", "Impact & achievements", [
        _crit("quantified", "Measurable results", 10 * min(1, (len(quantified) / n) / target_q) if n else 0, 10,
              f"Bullets with a number (count, %, money, time): {_pct(len(quantified), n)}. Target: about {int(target_q * 100)}%.",
              ["Where you can, add a real number: how many, how much, how fast. Only use figures you could explain in an interview."]
              if n and len(quantified) / n < target_q else ([] if n else ["Add bullet points describing your work."]),
              [b.ref for b in work_bullets if b not in quantified]),
        _crit("action_verbs", "Strong action verbs", 8 * min(1, (len(verbs) / n) / 0.8) if n else 0, 8,
              f"Bullets starting with an action verb: {_pct(len(verbs), n)}. Target: about 80%.",
              ["Start bullets with a verb such as Built, Led, Reduced, Designed."] if n and len(verbs) / n < 0.8 else [],
              [b.ref for b in work_bullets if b not in verbs]),
        _crit("weak_phrases", "No duty-style phrasing", 7 - 2 * len(weak), 7,
              "No duty-style phrases found." if not weak else f"{len(weak)} bullet(s) use phrases like 'responsible for' or 'worked on'.",
              ["Replace 'Responsible for X' with what you did and achieved."] if weak else [], [b.ref for b in weak]),
    ])

    # ---------------------------------------------------------------- clarity (20)
    in_range = [b for b in all_bullets if 6 <= T.word_count(b.text) <= 35]
    summary_words = [T.word_count(i.text) for s in sections if s.type == "summary" for i in s.items if i.text.strip()]
    summary_points = 0 if not summary_words else 4 if all(20 <= w <= 100 for w in summary_words) else 2
    first_person = [b for b in all_bullets if T.has_first_person(b.text)]
    clichés = T.cliches(full_text)
    clarity = _cat("clarity", "Clarity & concision", [
        _crit("bullet_length", "Bullet length", 8 * (len(in_range) / len(all_bullets)) if all_bullets else 0, 8,
              f"Bullets between 6 and 35 words: {_pct(len(in_range), len(all_bullets))}.",
              ["Keep each bullet to one or two lines; split long ones and expand fragments."] if len(in_range) < len(all_bullets) else [],
              [b.ref for b in all_bullets if b not in in_range]),
        _crit("summary", "Summary", summary_points, 4,
              "No summary." if not summary_words else f"Summary length: {', '.join(map(str, summary_words))} words (ideal 20-100).",
              ["Add a 2-4 sentence summary."] if not summary_words else (["Adjust the summary to 20-100 words."] if summary_points < 4 else [])),
        _crit("style", "Professional tone", 8 - 2 * len(first_person) - len(clichés), 8,
              "No first-person bullets or clichés found." if not (first_person or clichés)
              else f"{len(first_person)} bullet(s) use 'I/my'; clichés found: {', '.join(clichés) or 'none'}.",
              (["Drop 'I'/'my' from bullets."] if first_person else []) + (["Replace clichés with evidence."] if clichés else []),
              [b.ref for b in first_person]),
    ])

    # ---------------------------------------------------------------- consistency (15)
    date_errors = [i for i in issues if i.id in ("dates.end_before_start", "dates.future_start")]
    checked, consistent = tense
    dupes = [i for i in issues if i.id in ("bullets.duplicate", "skills.duplicate")]
    consistency = _cat("consistency", "Consistency", [
        _crit("date_logic", "Date logic", 0 if date_errors else 5, 5,
              "All dates are in a logical order." if not date_errors else f"{len(date_errors)} date problem(s): {date_errors[0].message}",
              [i.suggestion for i in date_errors if i.suggestion][:1], [i.ref for i in date_errors if i.ref]),
        _crit("tense", "Verb tense", 5 * (consistent / checked) if checked else 5, 5,
              f"Roles with consistent tense: {_pct(consistent, checked)}." if checked else "Not enough bullets to check tense; nothing to fix.",
              ["Present tense for your current role, past tense for earlier roles."] if checked and consistent < checked else []),
        _crit("duplicates", "No repetition", 5 - 2.5 * len(dupes), 5,
              "No repeated bullets or skills." if not dupes else f"{len(dupes)} repeated bullet(s) or skill(s).",
              ["Remove repeats."] if dupes else [], [i.ref for i in dupes if i.ref]),
    ])

    # ---------------------------------------------------------------- skills (10)
    skill_list = [sk for s in sections if s.type == "skills" for g in s.items if g.kind in ("technical", "tool", "domain") for sk in g.skills]
    all_skills = [sk for s in sections if s.type == "skills" for g in s.items for sk in g.skills]
    evidence_text = " ".join(b.text for b in work_bullets) + " " + " ".join(
        t for s in sections if s.type in ("experience", "projects") for i in s.items for t in i.technologies
    ) + " " + " ".join(i.text for s in sections if s.type == "summary" for i in s.items)
    evidenced = [sk for sk in skill_list if skill_mentioned(sk, evidence_text)]
    groups = [g for s in sections if s.type == "skills" for g in s.items]
    organised = len(all_skills) <= 12 or len([g for g in groups if g.name]) >= 2
    skills = _cat("skills", "Skills presentation", [
        _crit("skills_present", "Skills listed", 3 if len(all_skills) >= 5 else 1.5 if all_skills else 0, 3,
              f"{len(all_skills)} skill(s) listed.", ["List the skills you use, grouped by type."] if len(all_skills) < 5 else []),
        _crit("skills_evidence", "Skills backed by experience", 5 * min(1, (len(evidenced) / len(skill_list)) / 0.6) if skill_list else 0, 5,
              f"Skills that also appear in your experience or projects: {_pct(len(evidenced), len(skill_list))}." if skill_list else "No technical skills to check.",
              ["Mention key skills where you used them (in a bullet or the Technologies line). Only list skills you have actually used."]
              if skill_list and len(evidenced) / len(skill_list) < 0.6 else []),
        _crit("skills_organised", "Organisation", 0 if len(all_skills) > 40 else 2 if organised else 1, 2,
              "Skills are easy to scan." if organised and len(all_skills) <= 40 else "The skills list is long or ungrouped.",
              [] if organised and len(all_skills) <= 40 else ["Group skills and keep the strongest 15-30."]),
    ])

    # ---------------------------------------------------------------- length & focus (10)
    total_words = T.word_count(full_text)
    lo, hi = (200, 700) if early else (350, 900)
    if lo <= total_words <= hi:
        length_points = 5.0
    elif total_words < lo:
        length_points = 5 * max(0.0, (total_words - lo / 2) / (lo / 2))
    else:
        length_points = 5 * max(0.0, 1 - (total_words - hi) / hi)
    roles = dated_items(resume, ("experience",)) or (dated_items(resume, ("projects",)) if early else [])
    good_roles = [r for r in roles if 2 <= len(r.bullets) <= 6]
    length = _cat("length", "Length & focus", [
        _crit("word_count", "Overall length", length_points, 5,
              f"About {total_words} words (typical for your stage: {lo}-{hi}).",
              [] if lo <= total_words <= hi else (["Add more detail about your experience and results."] if total_words < lo
                                                   else ["Trim older or less relevant detail."])),
        _crit("bullets_per_role", "Bullets per role", 5 * (len(good_roles) / len(roles)) if roles else 0, 5,
              f"Entries with 2-6 bullets: {_pct(len(good_roles), len(roles))}.",
              ["Give each role 2-6 focused bullets."] if len(good_roles) < len(roles) or not roles else [],
              [r.ref for r in roles if r not in good_roles]),
    ])

    categories = [completeness, impact, clarity, consistency, skills, length]
    total = int(round(sum(cat.score for cat in categories)))
    weakest = sorted((c for cat in categories for c in cat.criteria if c.max_points), key=lambda c: c.points / c.max_points)[:3]
    strongest = [cat.label for cat in categories if cat.max_score and cat.score / cat.max_score >= 0.85]
    summary = (f"Strong: {', '.join(strongest)}. " if strongest else "") + (
        "Biggest opportunities: " + ", ".join(c.label.lower() for c in weakest if c.status != "good") + "."
        if any(c.status != "good" for c in weakest) else "No major issues found."
    )
    return Score(total=total, band=band_for(total), summary=summary, categories=categories)
