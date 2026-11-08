"""Resume analysis: consistency checks, Resume Quality Score and Parsing Readiness Score.

Deterministic: the same resume (and PDF) always produces the same result.
``today`` is injectable so date-based checks are reproducible in tests.
"""

from __future__ import annotations

from datetime import date

from ..schema import Resume
from . import checks
from . import text as T
from .models import AnalysisResult, Stats
from .parsing import score_parsing
from .quality import score_quality
from .view import all_text, bullets, dated_items, interval, merged_months

EARLY_CAREER_MONTHS = 24


def career_level(resume: Resume, today: date) -> tuple[str, str, int]:
    jobs = [
        it for it in dated_items(resume, ("experience",))
        if it.employment_type not in ("internship", "volunteer") and "intern" not in it.label.lower()
    ]
    months = merged_months([iv for it in jobs if (iv := interval(it, today))])
    if months < EARLY_CAREER_MONTHS:
        return "early", f"About {months} months of work experience (excluding internships), so early-career expectations apply.", months
    return "experienced", f"About {months // 12} years of work experience, so experienced-candidate expectations apply.", months


def analyze(resume: Resume, pdf: bytes | None = None, level: str = "auto", today: date | None = None) -> AnalysisResult:
    today = today or date.today()
    detected, reason, months = career_level(resume, today)
    if level in ("early", "experienced"):
        reason = f"Career stage set to '{level}' by you."
        detected = level

    text = all_text(resume)
    issues = []
    checks.check_contact(resume, issues)
    checks.check_dates(resume, issues, today)
    checks.check_bullets(resume, issues)
    tense = checks.check_tense(resume, issues)
    checks.check_sections(resume, issues, detected)
    checks.check_language(resume, issues, text)

    quality = score_quality(resume, issues, detected, tense, text)
    parsing, ats_text = score_parsing(resume, pdf)
    all_bullets = bullets(resume)
    stats = Stats(
        words=T.word_count(text),
        bullets=len(all_bullets),
        quantified_bullets=sum(1 for b in all_bullets if T.is_quantified(b.text)),
        experience_months=months,
        roles=len(dated_items(resume, ("experience",))),
    )
    order = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: order[i.severity])
    return AnalysisResult(career_level=detected, career_level_reason=reason, quality=quality, parsing=parsing,
                          issues=issues, stats=stats, ats_text=ats_text)
