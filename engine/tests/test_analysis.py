"""Analysis: checks, Quality Score and Parsing Readiness Score."""

import json
from datetime import date

import pytest
from conftest import FIXTURE_PATHS, load_fixture

from resume_engine.analysis import analyze, career_level
from resume_engine.analysis import text as T
from resume_engine.evals.import_report import RENDERED, without_unsorted
from resume_engine.importer import import_file
from resume_engine.schema import Resume

TODAY = date(2026, 11, 8)


def resume_from(data: dict) -> Resume:
    return Resume.model_validate(data)


def ids(result) -> list[str]:
    return [i.id for i in result.issues]


def fixture(stem: str) -> Resume:
    return resume_from(load_fixture(next(p for p in FIXTURE_PATHS if p.stem.startswith(stem))))


WEAK = {
    "contact": {"full_name": "Sam Lee", "email": "sam.lee@example"},
    "sections": [
        {"type": "summary", "title": "About me", "items": [{"text": "I am a hard-working team player and results-driven self-starter."}]},
        {"type": "experience", "title": "My Journey", "items": [
            {"title": "Assistant", "organization": "Shop", "bullets": [
                {"text": "Responsible for customers."},
                {"text": "I worked on various tasks."},
                {"text": "Responsible for customers."},
            ]},
            {"title": "Clerk", "organization": "Office", "start": {"year": 2023}, "end": {"year": 2021}, "bullets": []},
        ]},
    ],
}


# ---------------------------------------------------------------- language helpers

@pytest.mark.parametrize("text, verb", [
    ("Built a platform", True), ("Led a team", True), ("Modelled demand", True), ("Fixed bugs", True),
    ("Manages budgets", True), ("Visualized data", True), ("Responsible for budgets", False), ("Member of a committee", False),
])
def test_action_verbs(text, verb):
    assert T.starts_with_action_verb(text) is verb


def test_tense_and_metrics():
    assert T.verb_tense("Reduced costs") == "past" and T.verb_tense("Manage a team") == "present"
    assert T.is_quantified("Cut costs by 30%") and T.is_quantified("Served 3M requests") and T.is_quantified("Led 4 engineers")
    assert not T.is_quantified("Joined in 2023") and not T.is_quantified("Built dashboards")


# ---------------------------------------------------------------- scores discriminate

def test_weak_resume_scores_low_with_specific_reasons():
    result = analyze(resume_from(WEAK), today=TODAY)
    assert result.quality.total < 45, result.quality.summary
    found = set(ids(result))
    assert {"contact.email_invalid", "contact.phone_missing", "dates.end_before_start", "bullets.weak_phrase",
            "bullets.first_person", "bullets.duplicate", "role.no_bullets", "skills.missing", "text.cliche"} <= found
    # Every criterion explains itself.
    for cat in result.quality.categories:
        for c in cat.criteria:
            assert c.explanation


@pytest.mark.parametrize("path", FIXTURE_PATHS, ids=lambda p: p.stem)
def test_well_written_fixtures_score_well(path):
    result = analyze(resume_from(load_fixture(path)), (RENDERED / f"{path.stem}.classic.pdf").read_bytes(), today=TODAY)
    assert result.quality.total >= 80, result.quality.summary
    assert result.parsing.total >= 90, result.parsing.summary


def test_fixing_problems_raises_the_score():
    before = analyze(resume_from(WEAK), today=TODAY).quality.total
    better = json.loads(json.dumps(WEAK))
    better["contact"].update(email="sam.lee@example.com", phone="+44 7700 900123", location="Leeds, UK")
    better["sections"][1]["items"][0]["bullets"] = [
        {"text": "Served about 60 customers a day and resolved complaints on the spot."},
        {"text": "Trained 3 new staff members on the till and stock system."},
    ]
    after = analyze(resume_from(better), today=TODAY).quality.total
    assert after > before + 10


def test_analysis_is_deterministic():
    r = fixture("02")
    pdf = (RENDERED / "02_senior_software_engineer.classic.pdf").read_bytes()
    a = analyze(r, pdf, today=TODAY).model_dump()
    b = analyze(r, pdf, today=TODAY).model_dump()
    assert a == b


@pytest.mark.parametrize("stem", ["02_senior_software_engineer", "04_marketing_manager"])
def test_same_resume_same_score_across_input_formats(stem):
    """A resume uploaded as PDF, DOCX or pasted text gets the same analysis."""
    scores = set()
    for variant in ("classic.pdf", "modern.docx", "plain.txt", "paste.txt"):
        imported = without_unsorted(import_file((RENDERED / f"{stem}.{variant}").read_bytes()).resume)
        result = analyze(imported, today=TODAY)
        scores.add(result.quality.total)
    assert max(scores) - min(scores) <= 2, scores


# ---------------------------------------------------------------- fairness rules

def test_career_gap_is_information_only():
    data = {
        "contact": {"full_name": "A B"},
        "sections": [{"type": "experience", "title": "Experience", "items": [
            {"title": "Engineer", "organization": "X", "start": {"year": 2015, "month": 1}, "end": {"year": 2017, "month": 1}},
            {"title": "Engineer", "organization": "Y", "start": {"year": 2019, "month": 6}, "current": True},
        ]}],
    }
    result = analyze(resume_from(data), today=TODAY)
    [gap] = [i for i in result.issues if i.id == "dates.gap"]
    assert gap.severity == "info" and gap.affects_score is False
    assert "common and fine" in gap.suggestion


def test_sensitive_personal_details_are_flagged_neutrally():
    data = {"contact": {"full_name": "A B"}, "sections": [
        {"type": "custom", "title": "Personal Details", "items": [{"title": "Date of Birth: 1 Jan 2000"}]},
    ]}
    [issue] = [i for i in analyze(resume_from(data), today=TODAY).issues if i.id == "personal.sensitive"]
    assert issue.affects_score is False


def test_current_role_may_mix_tenses_but_past_role_may_not():
    data = {"contact": {"full_name": "A B"}, "sections": [{"type": "experience", "title": "Experience", "items": [
        {"title": "Lead", "organization": "X", "current": True, "start": {"year": 2022},
         "bullets": [{"text": "Manage a team of 5."}, {"text": "Launched a new product."}]},
        {"title": "Dev", "organization": "Y", "start": {"year": 2019}, "end": {"year": 2021},
         "bullets": [{"text": "Build APIs for partners."}, {"text": "Maintain the CI pipeline."}]},
    ]}]}
    found = ids(analyze(resume_from(data), today=TODAY))
    assert "bullets.tense_mixed" not in found
    assert found.count("bullets.past_role_present") == 1


def test_career_level_detection():
    level, reason, months = career_level(fixture("01"), TODAY)
    assert level == "early" and months == 0  # internships excluded
    level, _, months = career_level(fixture("02"), TODAY)
    assert level == "experienced" and months >= 96
    assert analyze(fixture("01"), level="experienced", today=TODAY).career_level == "experienced"


# ---------------------------------------------------------------- parsing readiness

def test_round_trip_detects_unreadable_heading():
    r = fixture("02")
    r.meta.template = "modern"  # modern prints headings as typed
    r.sections[1].title = "Where I've Been"  # experience under a non-standard heading
    result = analyze(r, today=TODAY)
    headings = next(c for cat in result.parsing.categories for c in cat.criteria if c.id == "headings")
    assert headings.status != "good"
    assert any("Where I've Been" in t for t in headings.tips)


def test_parsing_without_pdf_is_marked_not_measured():
    result = analyze(fixture("02"), today=TODAY)
    readback = result.parsing.categories[0].criteria[0]
    assert readback.status == "not_measured" and result.parsing.measured is False
    assert result.ats_text is None


def test_round_trip_returns_ats_text():
    result = analyze(fixture("02"), (RENDERED / "02_senior_software_engineer.classic.pdf").read_bytes(), today=TODAY)
    assert "Contoso Payments" in result.ats_text
    readback = result.parsing.categories[0].criteria[0]
    assert readback.points == readback.max_points
