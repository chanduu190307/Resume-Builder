"""Resume <-> job matching and the Job Match Score.

Keyword categories (from the product spec):
  present     - the skill appears in your work (experience/project bullets, technologies)
  equivalent  - present, but written differently from the job ("React" vs "React.js")
  weak        - only listed (skills section or summary), not shown in any role
  supported   - not written, but implied by something you do list (PostgreSQL -> SQL); you confirm
  missing     - not supported by anything in the resume

Every status comes with the resume text that justifies it.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..analysis import career_level
from ..analysis.models import Category, Criterion, Ref, Score, band_for, status_for
from ..analysis.view import dated_items, interval, merged_months, visible_sections
from ..schema import Resume
from .jd import JobAnalysis, JobRequirement, degree_level
from .skills import SkillHit, find_skills, implied_by


class _Model(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


KeywordStatus = Literal["present", "equivalent", "weak", "supported", "missing"]


class Evidence(_Model):
    text: str
    where: Literal["experience", "projects", "skills", "summary", "education", "certifications", "title", "other"]
    ref: Ref | None = None


class KeywordMatch(_Model):
    skill: str
    term: str = Field(description="The job's wording.")
    importance: Literal["required", "preferred", "mentioned"]
    status: KeywordStatus
    resume_terms: list[str] = Field(default_factory=list, description="How your resume writes it.")
    supported_by: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    explanation: str


class RequirementMatch(_Model):
    requirement_id: str
    text: str
    kind: Literal["required", "preferred", "responsibility"]
    category: str
    status: Literal["met", "partial", "not_met", "not_found"]
    explanation: str
    evidence: list[Evidence] = Field(default_factory=list)


class MatchResult(_Model):
    score: Score
    keywords: list[KeywordMatch]
    requirements: list[RequirementMatch]


# ----------------------------------------------------------------------------- resume index

class _Unit:
    __slots__ = ("text", "where", "ref", "hits", "section_type")

    def __init__(self, text: str, where: str, ref: Ref | None, section_type: str):
        self.text, self.where, self.ref, self.section_type = text, where, ref, section_type
        self.hits: list[SkillHit] = find_skills(text)


def _units(resume: Resume) -> list[_Unit]:
    units: list[_Unit] = []
    if resume.contact.headline:
        units.append(_Unit(resume.contact.headline, "title", Ref(field="contact.headline"), "contact"))
    for s in visible_sections(resume):
        for item in s.items:
            ref = Ref(section_id=s.id, item_id=item.id)
            if s.type == "summary":
                units.append(_Unit(item.text, "summary", ref, s.type))
            elif s.type == "skills":
                for sk in item.skills:
                    units.append(_Unit(sk, "skills", ref, s.type))
            elif s.type in ("experience", "projects"):
                where = "experience" if s.type == "experience" else "projects"
                head = item.title if s.type == "experience" else item.name
                if head:
                    units.append(_Unit(head, "title" if s.type == "experience" else where, ref, s.type))
                if item.technologies:
                    units.append(_Unit(", ".join(item.technologies), where, ref, s.type))
                for b in item.bullets:
                    if b.text.strip():
                        units.append(_Unit(b.text, where, Ref(section_id=s.id, item_id=item.id, bullet_id=b.id), s.type))
            elif s.type == "education":
                units.append(_Unit(" ".join(p for p in (item.degree, item.field_of_study, item.institution) if p), "education", ref, s.type))
                for b in item.bullets:
                    units.append(_Unit(b.text, "education", Ref(section_id=s.id, item_id=item.id, bullet_id=b.id), s.type))
            elif s.type == "certifications":
                units.append(_Unit(" ".join(p for p in (item.name, item.issuer) if p), "certifications", ref, s.type))
            elif s.type == "custom":
                units.append(_Unit(" ".join(p for p in (item.title, item.subtitle) if p), "other", ref, s.type))
                for b in item.bullets:
                    units.append(_Unit(b.text, "other", Ref(section_id=s.id, item_id=item.id, bullet_id=b.id), s.type))
            elif s.type == "languages":
                units.append(_Unit(f"{item.language} {item.proficiency or ''}".strip(), "other", ref, s.type))
            elif s.type in ("awards", "publications"):
                units.append(_Unit(" ".join(p for p in (item.title, getattr(item, "description", None)) if p), "other", ref, s.type))
    return units


_STRONG = {"experience", "projects", "title", "certifications"}


def _evidence(unit: _Unit) -> Evidence:
    text = unit.text if len(unit.text) <= 160 else unit.text[:157] + "…"
    return Evidence(text=text, where=unit.where, ref=unit.ref)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- keywords

def _match_keywords(job: JobAnalysis, units: list[_Unit]) -> list[KeywordMatch]:
    resume_skills = {h.skill for u in units for h in u.hits}
    out = []
    for kw in job.keywords:
        units_with = [u for u in units if any(h.skill == kw.skill for h in u.hits)]
        terms = list(dict.fromkeys(h.term for u in units_with for h in u.hits if h.skill == kw.skill))
        if not units_with:
            # Same multi-word skill in other words ("patient care" ~ "provide care for ... patients").
            units_with = [u for u in units if _stem_phrase_in(kw.term, u.text) or _stem_phrase_in(kw.skill, u.text)]
            terms = [u.text if len(u.text) <= 60 else u.text[:57] + "…" for u in units_with[:1]]
        strong = [u for u in units_with if u.where in _STRONG]
        same_wording = any(t.lower() == kw.term.lower() for t in terms)
        if strong:
            status: KeywordStatus = "present" if same_wording else "equivalent"
            where = sorted({u.where for u in strong})
            explanation = (f"Shown in your {', '.join(where)}." if same_wording
                           else f"You write it as “{terms[0]}”; the job says “{kw.term}”. Same skill.")
        elif units_with:
            status = "weak"
            explanation = ("Listed in your " + ", ".join(sorted({u.where for u in units_with}))
                           + ", but not shown in any role or project. Mention where you used it.")
        else:
            supporters = sorted(implied_by(kw.skill) & resume_skills)
            if supporters:
                status = "supported"
                explanation = (f"Not written as such, but you list {', '.join(supporters)}, which "
                               f"{'is' if len(supporters) == 1 else 'are'} a kind of {kw.skill}. Add it only if you have used {kw.skill} directly.")
            else:
                status = "missing"
                explanation = "Not found in your resume. If you have this experience, add it where you used it; otherwise it is a gap."
        supported_by = sorted(implied_by(kw.skill) & resume_skills) if status in ("supported", "missing") else []
        evidence_units = strong or units_with or [u for u in units if any(h.skill in supported_by for h in u.hits)]
        out.append(KeywordMatch(
            skill=kw.skill, term=kw.term, importance=kw.importance, status=status, resume_terms=terms,
            supported_by=supported_by, evidence=[_evidence(u) for u in evidence_units[:3]], explanation=explanation,
        ))
    return out


# ----------------------------------------------------------------------------- requirements

_STOP = set("""
a an the and or of to in on for with at by from as is are be been being this that these those it its your you our we
will would should can could may must able ability strong solid proven excellent good great deep hands hands-on
experience experienced years year knowledge understanding familiarity familiar proficiency proficient skills skill
including include such etc related similar equivalent plus preferred required requirement work working using use
etc demonstrated track record background minimum least other another any all both new well across within into
current currently valid active
""".split())


def _stems(text: str) -> set[str]:
    words = re.findall(r"[a-z][a-z0-9+#.-]*", text.lower())
    stems = {w[:5] for w in words if w not in _STOP and len(w) > 2}
    # Short acronyms carry meaning ("RN license", "UX", "QA").
    stems |= {a.lower() for a in re.findall(r"\b[A-Z]{2,5}\b", text)}
    return stems


def _stem_phrase_in(term: str, text: str) -> bool:
    """Multi-word skill written differently: every significant word stem of ``term`` is in ``text``
    ("patient care" ~ "provide care for ... patients"). Never used for one-word skills."""
    words = [w for w in re.findall(r"[a-z]+", term.lower()) if w not in _STOP and len(w) >= 4]
    if len(words) < 2:
        return False
    have = {w[:5] for w in re.findall(r"[a-z]+", text.lower())}
    return all(w[:5] in have for w in words)


def _best_overlap(req_text: str, units: list[_Unit]) -> tuple[float, list[_Unit]]:
    want = _stems(req_text)
    if len(want) < 2:
        return 0.0, []
    scored = sorted(((len(want & _stems(u.text)) / len(want), u) for u in units), key=lambda x: -x[0])
    best = scored[0][0] if scored else 0.0
    return best, [u for s, u in scored[:2] if s >= 0.34]


def _months_with(resume: Resume, units: list[_Unit], skills: list[str], today: date) -> tuple[int, list[str]]:
    items = [it for it in dated_items(resume, ("experience",)) if it.employment_type not in ("internship",)]
    if skills:
        def mentions(it) -> bool:
            texts = [it.label] + [b.text for b in it.bullets]
            return any(h.skill in skills or bool(set(skills) & implied_by(h.skill)) for t in texts for h in find_skills(t))
        items = [it for it in items if mentions(it)]
    return merged_months([iv for it in items if (iv := interval(it, today))]), [it.label for it in items]


def _match_requirement(req: JobRequirement, job: JobAnalysis, resume: Resume, units: list[_Unit],
                       keywords: dict[str, KeywordMatch], today: date) -> RequirementMatch:
    base = dict(requirement_id=req.id, text=req.text, kind=req.kind, category=req.category)

    if req.category == "experience" and req.years:
        months, roles = _months_with(resume, units, req.skills, today)
        have = months / 12
        what = f" in {', '.join(req.skills)}" if req.skills else ""
        status = "met" if have >= req.years else "partial" if have >= 0.6 * req.years else "not_met"
        expl = (f"Asks for {req.years:g}+ years{what}. Your resume shows about {have:.1f} years"
                + (f" ({'; '.join(roles[:3])})." if roles else "."))
        return RequirementMatch(**base, status=status, explanation=expl)  # type: ignore[arg-type]

    if req.category == "education":
        need = degree_level(req.text) or job.education_level
        levels = [(degree_level(" ".join(p for p in (i.degree, i.field_of_study) if p) or ""), s, i)
                  for s in visible_sections(resume) if s.type == "education" for i in s.items]
        best = max((lvl for lvl, _, _ in levels if lvl), default=None)
        names = {1: "school-level", 2: "associate/diploma", 3: "bachelor's", 4: "master's", 5: "doctoral"}
        ev = [Evidence(text=" ".join(p for p in (i.degree, i.field_of_study, i.institution) if p), where="education",
                       ref=Ref(section_id=s.id, item_id=i.id)) for lvl, s, i in levels if lvl == best]
        if need is None:
            return RequirementMatch(**base, status="not_found", explanation="Could not tell which qualification is required.")
        if best and best >= need:
            return RequirementMatch(**base, status="met", explanation=f"Asks for a {names[need]} degree; you have a {names[best]} qualification.", evidence=ev)
        if job.education_alternative:
            return RequirementMatch(**base, status="partial", explanation="The job accepts equivalent experience instead of the degree.", evidence=ev)
        return RequirementMatch(**base, status="not_met", explanation=f"Asks for a {names[need]} degree"
                                + (f"; your highest is {names[best]}." if best else "; no degree found."), evidence=ev)

    if req.skills:
        statuses = [keywords[s].status for s in req.skills if s in keywords]
        good = [s for s in req.skills if s in keywords and keywords[s].status in ("present", "equivalent")]
        okish = [s for s in req.skills if s in keywords and keywords[s].status in ("weak", "supported")]
        any_of = " or " in req.text.lower() or "/" in req.text
        ev = [e for s in req.skills if s in keywords for e in keywords[s].evidence[:1]]
        if (any_of and good) or (statuses and len(good) == len(req.skills)):
            return RequirementMatch(**base, status="met", explanation=f"Shown: {', '.join(good)}.", evidence=ev)
        if good or okish:
            return RequirementMatch(**base, status="partial",
                                    explanation=f"Shown: {', '.join(good) or 'none'}; listed or implied only: {', '.join(okish) or 'none'}; "
                                                f"missing: {', '.join(s for s in req.skills if s not in good and s not in okish) or 'none'}.",
                                    evidence=ev)
        return RequirementMatch(**base, status="not_met", explanation=f"Not found: {', '.join(req.skills)}.")

    overlap, best_units = _best_overlap(req.text, units)
    ev = [_evidence(u) for u in best_units]
    if overlap >= 0.75:
        return RequirementMatch(**base, status="met", explanation="Your resume describes this closely.", evidence=ev)
    if overlap >= 0.4:
        return RequirementMatch(**base, status="partial", explanation="Your resume touches on this; make it more explicit if it is a strength.", evidence=ev)
    return RequirementMatch(**base, status="not_found",
                            explanation="We could not find this in your resume. If you have it, describe it in a relevant role; if not, it is a gap.")


# ----------------------------------------------------------------------------- score

_CREDIT = {"present": 1.0, "equivalent": 1.0, "weak": 0.6, "supported": 0.4, "missing": 0.0}
_REQ_CREDIT = {"met": 1.0, "partial": 0.5, "not_met": 0.0, "not_found": 0.0}


def _crit(id: str, label: str, ratio: float | None, max_points: float, explanation: str, tips: list[str]) -> Criterion:
    if ratio is None:
        return Criterion(id=id, label=label, points=0, max_points=0, status="not_measured", explanation=explanation, tips=[])
    points = round(max_points * max(0.0, min(1.0, ratio)), 1)
    return Criterion(id=id, label=label, points=points, max_points=max_points, status=status_for(points, max_points),
                     explanation=explanation, tips=tips)


def _coverage(kws: list[KeywordMatch]) -> tuple[float | None, list[str], list[str]]:
    if not kws:
        return None, [], []
    ratio = sum(_CREDIT[k.status] for k in kws) / len(kws)
    have = [k.skill for k in kws if k.status in ("present", "equivalent")]
    gaps = [k.skill for k in kws if k.status in ("missing", "supported")]
    return ratio, have, gaps


def match(resume: Resume, job: JobAnalysis, today: date | None = None) -> MatchResult:
    today = today or date.today()
    units = _units(resume)
    keywords = _match_keywords(job, units)
    by_skill = {k.skill: k for k in keywords}
    requirements = [_match_requirement(r, job, resume, units, by_skill, today) for r in job.requirements]

    required_kw = [k for k in keywords if k.importance == "required"]
    preferred_kw = [k for k in keywords if k.importance == "preferred"]
    r_ratio, r_have, r_gaps = _coverage(required_kw)
    p_ratio, p_have, p_gaps = _coverage(preferred_kw)

    exp_reqs = [r for r in requirements if r.category == "experience" and r.kind == "required"]
    exp_ratio = (sum(_REQ_CREDIT[r.status] for r in exp_reqs) / len(exp_reqs)) if exp_reqs else None
    edu_reqs = [r for r in requirements if r.category == "education"]
    edu_ratio = (sum(_REQ_CREDIT[r.status] for r in edu_reqs) / len(edu_reqs)) if edu_reqs else None
    other_reqs = [r for r in requirements if r.category in ("other", "certification") or (r.kind == "responsibility" and r.category != "experience")]
    other_ratio = (sum(_REQ_CREDIT[r.status] for r in other_reqs) / len(other_reqs)) if other_reqs else None
    total_weight = sum(k.weight for k in job.keywords)
    found_weight = sum(next(k.weight for k in job.keywords if k.skill == m.skill) for m in keywords if m.status in ("present", "equivalent", "weak"))
    kw_ratio = found_weight / total_weight if total_weight else None

    def fmt(items: list[str]) -> str:
        return ", ".join(items[:8]) + (f" and {len(items) - 8} more" if len(items) > 8 else "") if items else "none"

    criteria = [
        _crit("required_skills", "Required skills", r_ratio, 35,
              f"Required skills shown: {fmt(r_have)}. Gaps: {fmt(r_gaps)}." if required_kw else "The job lists no specific required skills.",
              [f"Show where you used {s} (if you have)." for s in r_gaps[:3]]),
        _crit("preferred_skills", "Preferred skills", p_ratio, 15,
              f"Preferred skills shown: {fmt(p_have)}. Not shown: {fmt(p_gaps)}." if preferred_kw else "The job lists no preferred skills.",
              []),
        _crit("experience", "Experience level", exp_ratio, 15,
              " ".join(r.explanation for r in exp_reqs) if exp_reqs else "The job does not state a number of years.", []),
        _crit("education", "Education", edu_ratio, 10,
              " ".join(r.explanation for r in edu_reqs) if edu_reqs else "The job does not state an education requirement.", []),
        _crit("responsibilities", "Responsibilities & other requirements", other_ratio, 15,
              (f"{sum(1 for r in other_reqs if r.status == 'met')} met, {sum(1 for r in other_reqs if r.status == 'partial')} partly shown, "
               f"{sum(1 for r in other_reqs if r.status in ('not_met', 'not_found'))} not found, of {len(other_reqs)}.") if other_reqs else "Nothing else to compare.",
              ["Describe relevant responsibilities you have held in your roles."] if other_ratio is not None and other_ratio < 0.6 else []),
        _crit("keywords", "Keyword coverage", kw_ratio, 10,
              f"Job keywords found anywhere in your resume, weighted by importance: {round(100 * kw_ratio)}%." if kw_ratio is not None else "No keywords found in the job.",
              ["Use the job's wording for skills you have (e.g. in your skills list)."] if kw_ratio is not None and kw_ratio < 0.8 else []),
    ]
    categories = [Category(id=c.id, label=c.label, score=c.points, max_score=c.max_points, criteria=[c]) for c in criteria]
    measured = sum(c.max_points for c in criteria)
    total = int(round(100 * sum(c.points for c in criteria) / measured)) if measured else 0
    level, _, _ = career_level(resume, today)
    weak = [c.label.lower() for c in criteria if c.status in ("fair", "poor")]
    summary = (f"Strong match for {job.title or 'this job'}." if total >= 85 else
               f"Good match; to strengthen it: {', '.join(weak)}." if total >= 70 else
               f"Partial match; biggest gaps: {', '.join(weak) or 'see below'}.")
    if level == "early" and job.years_required and job.years_required >= 3:
        summary += " The role asks for more experience than your resume shows; highlight projects and internships that match."
    score = Score(total=total, band=band_for(total), summary=summary, categories=categories)
    return MatchResult(score=score, keywords=keywords, requirements=requirements)
