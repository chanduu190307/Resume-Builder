"""Truthful, deterministic tailoring suggestions for a specific job.

Every suggestion either (a) changes only wording or order of things you
already wrote, (b) adds a skill that your own bullets already show, or (c) asks
you to confirm before adding something implied by your resume. Gaps are
reported as gaps, never filled in. Missing numbers are asked for, never invented.
"""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..analysis import text as T
from ..analysis.models import Ref
from ..analysis.view import visible_sections
from ..schema import Resume
from .jd import JobAnalysis
from .match import KeywordMatch, MatchResult, _stem_phrase_in, _stems
from .skills import find_skills, get


class _Model(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


SuggestionKind = Literal[
    "use_job_wording", "add_evidenced_skill", "confirm_supported_skill", "reorder_skills", "reorder_bullets",
    "rewrite_bullet", "rewrite_summary", "add_metric", "summary_tip", "gap",
    # General enhancement (no job description):
    "remove_duplicate", "remove_first_person", "fix_tense", "rewrite_weak", "dedupe_skills", "tip",
]


class EditOp(_Model):
    op: Literal["replace_skill", "add_skill", "reorder_skills", "reorder_bullets", "set_bullet_text", "set_summary_text",
                "remove_bullet", "set_skills"]
    section_id: str | None = None
    item_id: str | None = None
    bullet_id: str | None = None
    old: str | None = None
    new: str | None = None
    order: list[str] = Field(default_factory=list, description="Skills (reorder_skills) or bullet ids (reorder_bullets).")
    origin: Literal["user", "ai_assisted"] = "user"


class Suggestion(_Model):
    id: str = Field(description="Stable across re-analysis, so rejected suggestions stay rejected.")
    kind: SuggestionKind
    title: str
    reason: str
    evidence: list[str] = Field(default_factory=list)
    needs_confirmation: bool = False
    confirmation: str | None = Field(default=None, description="Question the user must answer yes to before applying.")
    before: str | None = None
    after: str | None = None
    editable: bool = False
    ops: list[EditOp] = Field(default_factory=list)
    ref: Ref | None = None
    priority: int = Field(default=2, description="1 high, 2 medium, 3 low")
    skill: str | None = None


def _sid(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def _norm_term(t: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", t.lower())


def _wording_upgrade(resume_term: str, job_term: str, canonical: str) -> bool:
    """Only suggest the job's wording when it is at least as specific (React -> React.js,
    Kafka -> Apache Kafka), never a vaguer alias (PostgreSQL -> postgres)."""
    if resume_term.lower() == job_term.lower() or job_term.lower() in resume_term.lower():
        return False  # already contains the job's wording ("Google Analytics 4" covers "Google Analytics")
    if job_term == canonical:
        return True
    if resume_term.lower() in job_term.lower():
        return True
    return _norm_term(resume_term) == _norm_term(job_term) and len(job_term) >= len(resume_term)


_METRIC_QUESTIONS = [
    (r"^(built|developed|created|designed|launched|shipped|implemented|wrote|delivered)", "How many people used it, or what did it improve (time saved, errors reduced, revenue)?"),
    (r"^(reduced|cut|lowered|decreased|improved|increased|grew|boosted|raised|optimi[sz]ed|accelerated)", "By how much? A percentage, amount or before/after figure makes this concrete."),
    (r"^(led|managed|supervised|ran|headed|directed|coordinated|oversaw)", "How many people, projects or how large a budget?"),
    (r"^(trained|mentored|coached|taught|precepted|tutored|onboarded)", "How many people, and what was the outcome?"),
    (r"^(sold|won|negotiated|secured|acquired|closed)", "What was the value or volume?"),
    (r"^(supported|served|handled|answered|resolved|processed|maintained)", "How many (customers, tickets, systems) and how often?"),
]


def _metric_question(bullet: str) -> str:
    lower = bullet.lower()
    for pattern, question in _METRIC_QUESTIONS:
        if re.search(pattern, lower):
            return question
    return "Can you add a real number: how many, how much, how often, or how fast?"


_TECH_CATEGORIES = {"language", "framework", "library", "database", "cloud", "devops", "tool", "data", "technology",
                    "platform", "architecture", "design", "certification"}


def _skill_label(k: KeywordMatch) -> str:
    """Wording to add to a skills list: the job's own term for tools and technologies (what keyword
    searches look for), the proper skill name for broader skills ("Critical Care", not "ICU")."""
    skill = get(k.skill)
    if skill is None:
        return k.term
    if skill.category in _TECH_CATEGORIES and not (" " in k.term and k.term.islower()):
        return k.term
    return k.skill  # concept phrases read better as the skill name: "event streaming" -> "Event Streaming"


def _relevance(text: str, job: JobAnalysis) -> float:
    weights = {k.skill: k.weight for k in job.keywords}
    found = {h.skill for h in find_skills(text)}
    score = sum(weights.get(s, 0) for s in found)
    score += sum(k.weight for k in job.keywords if k.skill not in found and _stem_phrase_in(k.term, text))
    stems = _stems(text)
    for r in job.requirements:
        if r.kind in ("required", "responsibility"):
            req = _stems(r.text)
            if len(req) >= 2:
                score += 2 * len(req & stems) / len(req)
    return score


def suggest(resume: Resume, job: JobAnalysis, result: MatchResult) -> list[Suggestion]:
    out: list[Suggestion] = []
    sections = visible_sections(resume)
    skills_sections = [s for s in sections if s.type == "skills"]
    skill_strings = [(s, g, sk) for s in skills_sections for g in s.items for sk in g.skills]
    relevant: list[KeywordMatch] = [k for k in result.keywords if k.importance in ("required", "preferred")]

    # 1. Use the job's wording for skills you list.
    for k in relevant:
        if k.status not in ("present", "equivalent", "weak"):
            continue
        for s, g, sk in skill_strings:
            hits = [h for h in find_skills(sk) if h.skill == k.skill]
            if not hits or not _wording_upgrade(hits[0].term, k.term, k.skill):
                continue
            new = sk.replace(hits[0].term, k.term)
            out.append(Suggestion(
                id=_sid("wording", g.id, sk, new), kind="use_job_wording", skill=k.skill, priority=1,
                title=f"Write “{sk}” as “{new}”",
                reason=f"The job uses “{k.term}”. It is the same skill, and matching the wording helps keyword searches.",
                before=sk, after=new, ref=Ref(section_id=s.id, item_id=g.id),
                ops=[EditOp(op="replace_skill", section_id=s.id, item_id=g.id, old=sk, new=new)],
            ))

    listed = {h.skill for _, _, sk in skill_strings for h in find_skills(sk)}
    target_group = next(((s, g) for s in skills_sections for g in s.items if g.kind in ("technical", "tool")),
                        next(((s, g) for s in skills_sections for g in s.items), None))

    # 2. Add skills your experience already shows.
    for k in relevant:
        if k.status in ("present", "equivalent") and k.skill not in listed:
            used_in = [e.text for e in k.evidence if e.where in ("experience", "projects", "title")]
            if not used_in:
                continue
            label = _skill_label(k)
            ops = [EditOp(op="add_skill", section_id=target_group[0].id if target_group else None,
                          item_id=target_group[1].id if target_group else None, new=label)]
            out.append(Suggestion(
                id=_sid("add", k.skill), kind="add_evidenced_skill", skill=k.skill, priority=1,
                title=f"Add “{label}” to your skills",
                reason=f"The job {'requires' if k.importance == 'required' else 'prefers'} it, and your experience already shows it.",
                evidence=used_in[:2], after=label, ops=ops,
                ref=Ref(section_id=target_group[0].id, item_id=target_group[1].id) if target_group else None,
            ))

    # 3. Implied skills: only with the user's confirmation.
    for k in relevant:
        if k.status == "supported":
            label = _skill_label(k)
            out.append(Suggestion(
                id=_sid("confirm", k.skill), kind="confirm_supported_skill", skill=k.skill, priority=2,
                title=f"Add “{label}” if you have used it",
                reason=f"The job asks for {k.term}. You list {', '.join(k.supported_by)}, which suggests you may have this skill.",
                evidence=[e.text for e in k.evidence[:2]], needs_confirmation=True,
                confirmation=f"Have you used {label} yourself (not only {', '.join(k.supported_by)})?",
                after=label,
                ops=[EditOp(op="add_skill", section_id=target_group[0].id if target_group else None,
                            item_id=target_group[1].id if target_group else None, new=label)],
            ))

    # 4. Most relevant skills first.
    reorder_ops, befores, afters = [], [], []
    for s in skills_sections:
        for g in s.items:
            if len(g.skills) < 2:
                continue
            ranked = sorted(g.skills, key=lambda sk: -_relevance(sk, job))  # stable for ties
            if ranked != list(g.skills) and _relevance(ranked[0], job) > _relevance(g.skills[0], job):
                reorder_ops.append(EditOp(op="reorder_skills", section_id=s.id, item_id=g.id, order=ranked))
                befores.append(", ".join(g.skills))
                afters.append(", ".join(ranked))
    if reorder_ops:
        out.append(Suggestion(
            id=_sid("reorder_skills", *afters), kind="reorder_skills", priority=2,
            title="Put the skills this job asks for first",
            reason="Recruiters skim the first few skills in each group. Nothing is added or removed.",
            before="\n".join(befores), after="\n".join(afters), ops=reorder_ops,
        ))

    # 5. Most relevant bullets first, in each role.
    for s in sections:
        if s.type not in ("experience", "projects"):
            continue
        for item in s.items:
            bullets = [b for b in item.bullets if b.text.strip()]
            if len(bullets) < 2:
                continue
            ranked = sorted(bullets, key=lambda b: -_relevance(b.text, job))
            top, current = _relevance(ranked[0].text, job), _relevance(bullets[0].text, job)
            if ranked[0].id != bullets[0].id and top >= 1.3 * current + 0.5:  # only when clearly more relevant
                label = item.title if s.type == "experience" else item.name
                out.append(Suggestion(
                    id=_sid("reorder_bullets", item.id, *[b.id for b in ranked]), kind="reorder_bullets", priority=2,
                    title=f"Lead with your most relevant point for {label or 'this role'}",
                    reason="Move the bullet that best matches the job to the top. Wording is unchanged.",
                    before="\n".join(b.text for b in bullets), after="\n".join(b.text for b in ranked),
                    ref=Ref(section_id=s.id, item_id=item.id),
                    ops=[EditOp(op="reorder_bullets", section_id=s.id, item_id=item.id, order=[b.id for b in ranked])],
                ))

    # 6. Ask for real numbers on relevant bullets that have none.
    prompts = []
    for s in sections:
        if s.type != "experience":
            continue
        for item in s.items:
            for b in item.bullets:
                if b.text.strip() and not T.is_quantified(b.text):
                    prompts.append((_relevance(b.text, job), s, item, b))
    for _, s, item, b in sorted(prompts, key=lambda p: -p[0])[:5]:
        out.append(Suggestion(
            id=_sid("metric", b.id, b.text), kind="add_metric", priority=2,
            title="Add a real number to this point",
            reason=_metric_question(b.text) + " Only use a figure you could explain in an interview.",
            before=b.text, editable=True, ref=Ref(section_id=s.id, item_id=item.id, bullet_id=b.id),
            ops=[EditOp(op="set_bullet_text", section_id=s.id, item_id=item.id, bullet_id=b.id, old=b.text)],
        ))

    # 7. Summary: which matching strengths it does not mention yet.
    summaries = [(s, i) for s in sections if s.type == "summary" for i in s.items if i.text.strip()]
    if summaries:
        s, item = summaries[0]
        in_summary = {h.skill for h in find_skills(item.text)}
        mention = [k.term for k in relevant if k.status in ("present", "equivalent") and k.skill not in in_summary][:4]
        if mention:
            out.append(Suggestion(
                id=_sid("summary_tip", *mention), kind="summary_tip", priority=3,
                title="Mention your matching strengths in your summary",
                reason=f"The job asks for {', '.join(mention)}, which your experience shows but your summary does not mention.",
                ref=Ref(section_id=s.id, item_id=item.id),
            ))

    # 8. Gaps: reported honestly, never filled in.
    for k in result.keywords:
        if k.importance == "required" and k.status == "missing":
            out.append(Suggestion(
                id=_sid("gap", k.skill), kind="gap", skill=k.skill, priority=3,
                title=f"Gap: {k.term}",
                reason=(f"The job requires {k.term} and your resume does not show it. If you have used it, add it to the role where "
                        f"you did. If not, this is a genuine gap: consider addressing it in your cover letter or by learning it."),
            ))
    for r in result.requirements:
        if r.kind == "required" and r.status in ("not_met", "not_found") and r.category in ("experience", "education", "certification", "other"):
            out.append(Suggestion(
                id=_sid("gap_req", r.text), kind="gap", priority=3, title="Requirement not shown",
                reason=f"“{r.text}” — {r.explanation}",
            ))

    order = {"use_job_wording": 0, "add_evidenced_skill": 1, "confirm_supported_skill": 2, "reorder_bullets": 3,
             "reorder_skills": 4, "add_metric": 5, "rewrite_summary": 6, "rewrite_bullet": 7, "summary_tip": 8, "gap": 9}
    out.sort(key=lambda s: (s.priority, order[s.kind]))
    return out
