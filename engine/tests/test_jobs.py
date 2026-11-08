"""Job description analysis, matching, tailoring suggestions and the AI truthfulness guard."""

import copy
import json
from datetime import date
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from resume_engine.jobs.jd import analyze_job, degree_level
from resume_engine.jobs.match import match
from resume_engine.jobs.ontology import SKILLS
from resume_engine.jobs.rewrite import TruthGuard, suggest_rewrites
from resume_engine.jobs.skills import find_skills, implied_by
from resume_engine.jobs.tailor import suggest
from resume_engine.schema import Resume

TODAY = date(2026, 11, 8)
JOBS = REPO_ROOT / "fixtures" / "jobs"


def job(name: str):
    return analyze_job((JOBS / f"{name}.txt").read_text(encoding="utf-8"))


def resume(stem: str) -> Resume:
    path = next((REPO_ROOT / "fixtures" / "resumes").glob(f"{stem}*.json"))
    return Resume.model_validate(json.loads(path.read_text(encoding="utf-8")))


# ---------------------------------------------------------------- ontology & matcher

def test_ontology_parses_and_aliases_are_unambiguous():
    assert len(SKILLS) > 200
    seen: dict[str, str] = {}
    for skill in SKILLS.values():
        for term in skill.aliases:
            key = term.lower()
            assert seen.setdefault(key, skill.name) == skill.name, f"'{term}' maps to {seen[key]} and {skill.name}"
        for implied in skill.implies:
            assert implied in SKILLS, f"{skill.name} implies unknown skill {implied}"


@pytest.mark.parametrize("text, expected", [
    ("React.js and Node with PostgreSQL", ["React", "Node.js", "PostgreSQL"]),
    ("k8s, CI/CD and Golang", ["Kubernetes", "CI/CD", "Go"]),
    ("React Native, Spring Boot", ["React Native", "Spring Boot"]),
    ("C, C++ and C#", ["C", "C++", "C#"]),
    ("Excel in a fast-paced role. Go above and beyond.", []),
    ("C-suite stakeholders and R&D budgets; the rest of the team; a graph node", []),
    ("We move swiftly with express delivery", []),
])
def test_find_skills(text, expected):
    assert [h.skill for h in find_skills(text)] == expected


def test_implied_by():
    assert {"PostgreSQL", "MySQL"} <= implied_by("SQL")
    assert "CKAD" in implied_by("Kubernetes")


# ---------------------------------------------------------------- JD analysis

def test_backend_job_analysis():
    j = job("backend_engineer")
    assert j.title == "Senior Backend Engineer, Payments"
    assert j.company == "Northbridge Finance"
    assert j.years_required == 5 and j.education_level == 3 and j.education_alternative
    required = {k.skill for k in j.keywords if k.importance == "required"}
    preferred = {k.skill for k in j.keywords if k.importance == "preferred"}
    assert {"Go", "Java", "Apache Kafka", "PostgreSQL", "Kubernetes", "AWS"} <= required
    assert {"Terraform", "gRPC"} <= preferred
    assert not any(r.text.startswith("Remote-friendly") for r in j.requirements)  # Benefits section ignored
    texts = [r.text for r in j.requirements]
    assert "Strong proficiency in Golang or Java." in texts  # verbatim


@pytest.mark.parametrize("name, heading_kind", [("data_analyst", "Desirable"), ("marketing_lead", "Bonus"), ("icu_nurse", "Preferred")])
def test_preferred_sections_with_different_headings(name, heading_kind):
    assert any(r.kind == "preferred" for r in job(name).requirements), heading_kind


def test_degree_levels():
    assert degree_level("Bachelor of Engineering") == 3
    assert degree_level("Master of Science") == 4
    assert degree_level("PhD") == 5
    assert degree_level("PGCE") is None  # a teaching certificate, not a master's degree


def test_inline_preferred_cue_overrides_section():
    j = analyze_job("Requirements\n- 3+ years of Python experience\n- Kubernetes experience is a plus")
    kinds = {r.text: r.kind for r in j.requirements}
    assert kinds["3+ years of Python experience"] == "required"
    assert kinds["Kubernetes experience is a plus"] == "preferred"


# ---------------------------------------------------------------- matching

def test_match_categories_and_explanations():
    m = match(resume("02"), job("backend_engineer"), today=TODAY)
    status = {k.skill: k.status for k in m.keywords}
    assert status["Java"] == "present"
    assert status["Go"] == "equivalent"  # resume says Go, job says Golang
    assert status["Terraform"] == "weak"  # only in the skills list
    assert status["Infrastructure as Code"] == "supported"  # implied by Terraform
    assert status["gRPC"] == "missing"
    for k in m.keywords:
        assert k.explanation
        if k.status in ("present", "equivalent", "weak"):
            assert k.evidence, k.skill
    req = {r.text: r for r in m.requirements}
    assert req["Strong proficiency in Golang or Java."].status == "met"
    assert req["5+ years of experience building backend systems in production."].status == "met"
    assert 70 <= m.score.total <= 95


def test_match_scores_rank_sensibly():
    strong = match(resume("05"), job("icu_nurse"), today=TODAY).score.total
    weak = match(resume("01"), job("backend_engineer"), today=TODAY).score.total
    assert strong >= 85 and weak <= 35


def test_job_match_is_separate_from_quality():
    """A well-written resume can still be a poor match for an unrelated job."""
    from resume_engine.analysis import analyze

    r = resume("05")
    assert analyze(r, today=TODAY).quality.total >= 80
    assert match(r, job("backend_engineer"), today=TODAY).score.total < 30


def test_match_is_deterministic():
    r = resume("03")
    a = match(r, job("data_analyst"), today=TODAY).model_dump()
    b = match(r, job("data_analyst"), today=TODAY).model_dump()  # job re-analysed: same requirement ids
    assert a == b


# ---------------------------------------------------------------- tailoring suggestions

def test_suggestions_are_truthful():
    r, j = resume("02"), job("backend_engineer")
    suggestions = suggest(r, j, match(r, j, today=TODAY))
    kinds = [s.kind for s in suggestions]
    wording = [s for s in suggestions if s.kind == "use_job_wording"]
    assert {(s.before, s.after) for s in wording} >= {("Kafka", "Apache Kafka"), ("Go", "Golang")}
    # gRPC is missing and not implied: never suggested as an addition, reported as... (preferred, so no gap card)
    assert not any(s.kind in ("add_evidenced_skill", "confirm_supported_skill") and s.skill == "gRPC" for s in suggestions)
    # Implied skills always need confirmation.
    for s in suggestions:
        if s.kind == "confirm_supported_skill":
            assert s.needs_confirmation and s.confirmation
    # Metric prompts never contain a number to insert.
    for s in suggestions:
        if s.kind == "add_metric":
            assert s.ops and s.ops[0].new is None
    assert "reorder_skills" in kinds


def test_missing_required_skill_is_a_gap_not_an_edit():
    r, j = resume("04"), job("marketing_lead")
    suggestions = suggest(r, j, match(r, j, today=TODAY))
    gaps = [s for s in suggestions if s.kind == "gap" and s.skill == "Content Marketing"]
    assert gaps and gaps[0].ops == []


def test_no_downgrade_of_specific_wording():
    r, j = resume("04"), job("marketing_lead")
    suggestions = suggest(r, j, match(r, j, today=TODAY))
    assert not any(s.kind == "use_job_wording" and s.before == "Google Analytics 4" for s in suggestions)


def test_suggestion_ids_are_stable():
    r, j = resume("02"), job("backend_engineer")
    a = [s.id for s in suggest(r, j, match(r, j, today=TODAY))]
    b = [s.id for s in suggest(r, j, match(r, j, today=TODAY))]
    assert a == b


# ---------------------------------------------------------------- truthfulness guard

GUARD_RESUME = "Built the route-optimization API serving 3M requests per day using Java and Kafka at Fabrikam Logistics."


@pytest.mark.parametrize("proposed, problem", [
    ("Built a route-optimization API serving 3M daily requests, cutting latency by 40%.", "numbers"),
    ("Built the route-optimization API in Java and Kubernetes serving 3M requests per day.", "skills"),
    ("Built Google's route-optimization API serving 3M requests per day.", "name"),
    ("Brought 5 years of experience to building the route API serving 3M requests per day.", "years"),
    ("I built the route-optimization API serving 3M requests per day.", "first person"),
])
def test_guard_rejects_invented_content(proposed, problem):
    reasons = TruthGuard(GUARD_RESUME).check(GUARD_RESUME, proposed)
    assert reasons, problem


@pytest.mark.parametrize("proposed", [
    "Engineered a route-optimization API in Java serving 3M requests per day.",
    "Built the route-optimization API on Apache Kafka and Java, serving 3M requests per day.",
])
def test_guard_accepts_truthful_rewording(proposed):
    assert TruthGuard(GUARD_RESUME).check(GUARD_RESUME, proposed) == []


class FakeLLM:
    model = "fake"

    def __init__(self, output):
        self.output = output
        self.calls = []

    def generate_json(self, *, system, content, schema, max_tokens=16000, effort="medium"):
        self.calls.append(content)
        return copy.deepcopy(self.output)


def test_ai_rewrites_pass_through_the_guard():
    r, j = resume("02"), job("backend_engineer")
    m = match(r, j, today=TODAY)
    exp = next(s for s in r.sections if s.type == "experience")
    good_bullet, bad_bullet = exp.items[1].bullets[0], exp.items[1].bullets[1]
    fake = FakeLLM({
        "summary": None,
        "bullets": [
            {"bullet_id": good_bullet.id, "text": "Engineered the route-optimization API serving 3M requests per day.", "reason": "Stronger verb."},
            {"bullet_id": bad_bullet.id, "text": "Introduced Redis caching, cutting database load by 60% and saving $2M.", "reason": "More impact."},
        ],
    })
    result = suggest_rewrites(fake, r, j, m)
    assert [s.after for s in result.suggestions] == ["Engineered the route-optimization API serving 3M requests per day."]
    op = result.suggestions[0].ops[0]
    assert op.op == "set_bullet_text" and op.origin == "ai_assisted"
    assert len(result.rejected) == 1 and "adds numbers" in result.rejected[0].reasons[0]
    prompt = fake.calls[0][0]["text"]
    assert "<bullets>" in prompt and good_bullet.id in prompt


# ---------------------------------------------------------------- cover letter

def test_cover_letter_draft_uses_only_resume_and_job_facts():
    from resume_engine.jobs.cover_letter import draft_cover_letter

    r, j = resume("02"), job("backend_engineer")
    draft = draft_cover_letter(r, j, match(r, j, today=TODAY))
    assert draft.startswith("Dear Northbridge Finance hiring team,")
    assert "I am a backend engineer with 8 years" in draft
    assert "At Contoso Payments, I led a team of 5 engineers" in draft
    all_bullets = {b.text.rstrip(".") for s in r.sections for i in s.items for b in getattr(i, "bullets", [])}
    for line in draft.splitlines():
        if line.startswith("- "):
            sentence = line.split("I ", 1)[1].rstrip(".")
            assert any(sentence.lower() == b.lower() for b in all_bullets), line
    assert draft.rstrip().endswith("marcus.bennett@example.com | +1 (555) 010-0142")


def test_cover_letter_polish_is_guarded():
    from resume_engine.jobs.cover_letter import draft_cover_letter, polish_cover_letter

    r, j = resume("02"), job("backend_engineer")
    draft = draft_cover_letter(r, j, match(r, j, today=TODAY))
    good = draft.replace("Some of my experience that matches what you are looking for:", "Here is how my experience fits:")
    result = polish_cover_letter(FakeLLM({"text": good}), r, j, draft)
    assert result.method == "ai" and result.text == good  # first person and the company name are fine
    bad = draft + "\nI also grew revenue by 300% at Google."
    result = polish_cover_letter(FakeLLM({"text": bad}), r, j, draft)
    assert result.method == "draft" and result.text == draft
    assert any("numbers" in x for x in result.rejected_reasons) and any("Google" in x for x in result.rejected_reasons)
