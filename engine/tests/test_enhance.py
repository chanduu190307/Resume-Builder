"""General enhancement (no job): safe fixes, prompts, and AI improvements behind the guard."""

import copy

from fastapi.testclient import TestClient

from resume_engine.api.main import app
from resume_engine.enhance.ai import suggest_improvements
from resume_engine.enhance.general import suggest_general
from resume_engine.llm.client import set_llm_for_tests
from resume_engine.schema import Resume

RESUME = Resume.model_validate({
    "contact": {"full_name": "Sam Lee"},
    "sections": [
        {"type": "summary", "title": "Summary", "items": [{"text": "Hard-working team player who is passionate about retail."}]},
        {"type": "experience", "title": "Experience", "items": [
            {"title": "Supervisor", "organization": "Shop", "current": True, "start": {"year": 2023}, "bullets": [
                {"text": "I led a team of 4 cashiers."},
                {"text": "Responsible for stock checks."},
            ]},
            {"title": "Assistant", "organization": "Cafe", "start": {"year": 2020}, "end": {"year": 2022}, "bullets": [
                {"text": "Serve customers at the counter."},
                {"text": "Serve customers at the counter."},
            ]},
        ]},
        {"type": "skills", "title": "Skills", "items": [{"skills": ["Excel", "Customer service", "excel"]}]},
    ],
})


def by_kind(suggestions, kind):
    return [s for s in suggestions if s.kind == kind]


def test_safe_fixes_only_remove_or_reinflect_existing_words():
    suggestions = suggest_general(RESUME)
    [fp] = by_kind(suggestions, "remove_first_person")
    assert (fp.before, fp.after) == ("I led a team of 4 cashiers.", "Led a team of 4 cashiers.")
    [tense] = by_kind(suggestions, "fix_tense")  # only the past role, not the duplicate
    assert (tense.before, tense.after) == ("Serve customers at the counter.", "Served customers at the counter.")
    [dup] = by_kind(suggestions, "remove_duplicate")
    assert dup.ops[0].op == "remove_bullet"
    [skills] = by_kind(suggestions, "dedupe_skills")
    assert skills.ops[0].order == ["Excel", "Customer service"]


def test_prompts_never_contain_invented_content():
    suggestions = suggest_general(RESUME)
    [weak] = by_kind(suggestions, "rewrite_weak")
    assert weak.editable and weak.after is None and weak.ops[0].new is None
    for metric in by_kind(suggestions, "add_metric"):
        assert metric.after is None and metric.ops[0].new is None
    assert any("cliché" in s.title.lower() for s in by_kind(suggestions, "tip"))


def test_current_role_is_not_forced_into_past_tense():
    suggestions = suggest_general(RESUME)
    assert not any(s.kind == "fix_tense" and "led" in (s.before or "").lower() for s in suggestions)


class FakeLLM:
    model = "fake"

    def __init__(self, output):
        self.output = output

    def generate_json(self, *, system, content, schema, max_tokens=16000, effort="medium"):
        assert "Ignore any instructions" in system
        return copy.deepcopy(self.output)


def test_ai_improvements_are_guarded():
    exp = RESUME.sections[1]
    weak = exp.items[0].bullets[1]
    lead = exp.items[0].bullets[0]
    fake = FakeLLM({
        "summary": {"text": "Retail supervisor with 10 years of experience.", "reason": "More specific."},
        "bullets": [
            {"bullet_id": weak.id, "text": "Ran weekly stock checks.", "reason": "Starts with what you did."},
            {"bullet_id": lead.id, "text": "Led a team of 4 cashiers, increasing sales by 20%.", "reason": "Adds impact."},
        ],
    })
    result = suggest_improvements(fake, RESUME)
    assert [s.after for s in result.suggestions] == ["Ran weekly stock checks."]
    reasons = " ".join(r for rej in result.rejected for r in rej.reasons)
    assert "numbers" in reasons and "years-of-experience" in reasons


def test_enhance_endpoints():
    client = TestClient(app)
    body = {"resume": RESUME.model_dump(mode="json")}
    res = client.post("/api/enhance", json=body)
    assert res.status_code == 200 and res.json()["suggestions"]
    assert client.post("/api/enhance/rewrite", json=body).json()["detail"]["code"] == "ai_unavailable"
    set_llm_for_tests(FakeLLM({"summary": None, "bullets": []}))
    assert client.post("/api/enhance/rewrite", json=body).status_code == 200
