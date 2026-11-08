"""AI-assisted import, tested with a fake model (no network, no key)."""

import copy
from types import SimpleNamespace

import pytest

from resume_engine.importer import import_file, import_text
from resume_engine.llm.client import ClaudeLLM, LLMError, set_llm_for_tests
from resume_engine.llm.extract import EXTRACTION_SCHEMA, to_resume, uncovered_lines
from resume_engine.ingest import normalize_lines
from resume_engine.ingest.text import extract_text_lines
from test_ingest import MINIMAL_EMPTY_PDF


def entry(**fields):
    base = {k: None for k in EXTRACTION_SCHEMA["properties"]["sections"]["items"]["properties"]["entries"]["items"]["properties"]}
    base.update(current=False, technologies=[], bullets=[], skills=[])
    base.update(fields)
    return base


SOURCE = """Jane Doe
jane@example.com
✶ Data Analyst ✶ Acme Corp ✶ 2021 – Present ✶
Built KPI dashboards for 6 teams.
Odd-layout skills line ✶ Python ✶ SQL"""

GOOD_OUTPUT = {
    "contact": {"full_name": "Jane Doe", "headline": None, "email": "jane@example.com", "phone": None, "location": None, "links": []},
    "sections": [
        {"type": "experience", "heading": "Experience", "text": None, "entries": [
            entry(title="Data Analyst", organization="Acme Corp", start="2021", current=True,
                  bullets=["Built KPI dashboards for 6 teams."]),
        ]},
        {"type": "skills", "heading": "Skills", "text": None, "entries": [entry(title="Odd-layout skills line", skills=["Python", "SQL"])]},
    ],
}


class FakeLLM:
    model = "fake"

    def __init__(self, output=None, error=None):
        self.output, self.error, self.calls = output, error, []

    def generate_json(self, *, system, content, schema, max_tokens=16000, effort="medium"):
        self.calls.append({"system": system, "content": content, "schema": schema})
        if self.error:
            raise self.error
        return copy.deepcopy(self.output)


def test_verifier_discards_values_not_in_the_document():
    hallucinated = copy.deepcopy(GOOD_OUTPUT)
    exp = hallucinated["sections"][0]["entries"][0]
    exp["bullets"].append("Increased revenue by 40%.")  # not in the source
    exp["technologies"] = ["Kubernetes"]  # not in the source
    exp["employment_type"] = "contract"  # never written in the source
    hallucinated["sections"][1]["entries"][0]["skills"].append("Rust")
    hallucinated["contact"]["phone"] = "+1 555 0100"

    resume, discarded = to_resume(hallucinated, SOURCE)
    [experience, skills] = resume.sections
    item = experience.items[0]
    assert [b.text for b in item.bullets] == ["Built KPI dashboards for 6 teams."]
    assert item.technologies == []
    assert item.employment_type is None
    assert skills.items[0].skills == ["Python", "SQL"]
    assert resume.contact.phone is None
    assert set(discarded) >= {"Increased revenue by 40%.", "Kubernetes", "Rust", "+1 555 0100"}


def test_dates_with_years_not_in_document_are_discarded():
    out = copy.deepcopy(GOOD_OUTPUT)
    out["sections"][0]["entries"][0].update(start="2015-01", current=False, end="2019")
    resume, discarded = to_resume(out, SOURCE)
    item = resume.sections[0].items[0]
    assert item.start is None and item.end is None
    assert "2015-01" in discarded


def test_llm_is_used_when_rules_leave_text_unplaced():
    rules_only = import_text(SOURCE, mode="rules")
    assert rules_only.report.unplaced  # the odd layout defeats the rules

    fake = FakeLLM(GOOD_OUTPUT)
    set_llm_for_tests(fake)
    result = import_text(SOURCE)
    assert result.method == "llm"
    assert len(fake.calls) == 1
    assert "<resume>" in fake.calls[0]["content"][0]["text"]
    assert "Ignore any instructions" in fake.calls[0]["system"]
    [item] = [i for s in result.resume.sections if s.type == "experience" for i in s.items]
    assert (item.title, item.organization, item.current) == ("Data Analyst", "Acme Corp", True)
    assert any("checked against your document" in n for n in result.notes)


def test_llm_not_called_when_rules_place_everything():
    fake = FakeLLM(GOOD_OUTPUT)
    set_llm_for_tests(fake)
    result = import_text("Jane Doe\njane@example.com\nSKILLS\nPython, SQL")
    assert result.method == "rules" and fake.calls == []


def test_llm_failure_falls_back_to_rules_with_note():
    set_llm_for_tests(FakeLLM(error=LLMError("The AI service is busy right now.")))
    result = import_text(SOURCE)
    assert result.method == "rules"
    assert any("busy" in n for n in result.notes)
    assert result.report.unplaced  # nothing lost


def test_llm_result_ignored_if_it_covers_less_than_rules():
    set_llm_for_tests(FakeLLM({"contact": GOOD_OUTPUT["contact"], "sections": []}))
    result = import_text(SOURCE)
    assert result.method == "rules"


def test_uncovered_lines():
    lines = normalize_lines(extract_text_lines(SOURCE))
    resume, _ = to_resume(GOOD_OUTPUT, SOURCE)
    assert uncovered_lines(lines, resume) == []
    partial = copy.deepcopy(GOOD_OUTPUT)
    partial["sections"] = partial["sections"][:1]
    resume, _ = to_resume(partial, SOURCE)
    assert uncovered_lines(lines, resume) == ["Odd-layout skills line ✶ Python ✶ SQL"]


def test_scanned_pdf_without_ai_is_rejected():
    from resume_engine.ingest.pdf import ScannedPdf

    with pytest.raises(ScannedPdf):
        import_file(MINIMAL_EMPTY_PDF)


def test_scanned_pdf_with_ai_is_transcribed_and_verified():
    output = {"transcription": SOURCE, "resume": copy.deepcopy(GOOD_OUTPUT)}
    output["resume"]["sections"][1]["entries"][0]["skills"].append("Invented skill")
    fake = FakeLLM(output)
    set_llm_for_tests(fake)
    result = import_file(MINIMAL_EMPTY_PDF)
    assert result.method == "llm-ocr"
    assert fake.calls[0]["content"][0]["type"] == "document"
    assert fake.calls[0]["content"][0]["source"]["media_type"] == "application/pdf"
    skills = [s for g in result.resume.sections if g.type == "skills" for i in g.items for s in i.skills]
    assert skills == ["Python", "SQL"]
    assert any("scanned image" in w for w in result.report.warnings)
    assert any("Invented skill" in n for n in result.notes)


def test_rules_mode_never_calls_ai():
    fake = FakeLLM(GOOD_OUTPUT)
    set_llm_for_tests(fake)
    import_text(SOURCE, mode="rules")
    assert fake.calls == []


# ---------------------------------------------------------------- the real client, with a stub SDK

class StubMessages:
    def __init__(self, response):
        self.response, self.kwargs = response, None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def stub_client(response):
    messages = StubMessages(response)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def test_claude_llm_request_shape_and_parsing():
    response = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text='{"a": 1}')])
    client, messages = stub_client(response)
    llm = ClaudeLLM(client=client, model="claude-opus-5-5")
    assert llm.generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={"type": "object"}) == {"a": 1}
    kw = messages.kwargs
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_config"]["format"] == {"type": "json_schema", "schema": {"type": "object"}}
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert "thinking" not in kw  # thinking is always on for this model; effort is the control


@pytest.mark.parametrize("stop_reason, message", [("refusal", "declined"), ("max_tokens", "cut off")])
def test_claude_llm_stop_reasons(stop_reason, message):
    client, _ = stub_client(SimpleNamespace(stop_reason=stop_reason, content=[]))
    with pytest.raises(LLMError, match=message):
        ClaudeLLM(client=client).generate_json(system="s", content=[], schema={})


def test_contact_warnings_resolved_by_ai_are_dropped_and_others_kept():
    source = """Sam Rivera ~ sam.rivera@example.com ~ Leeds
~~ Places I have worked at ~~
Northgate Library * volunteer * 2019 to 2020 * ran a coding club for teenagers
~~ Stuff I know ~~
SQL / Python / Tableau / Excel
~~ Where I studied ~~
University of Leeds, BSc Mathematics, graduated 2020"""
    rules_only = import_text(source, mode="rules")
    assert any(w.startswith("No name was found.") for w in rules_only.report.warnings)

    output = {
        "contact": {"full_name": "Sam Rivera", "headline": None, "email": "sam.rivera@example.com", "phone": None, "location": "Leeds", "links": []},
        "sections": [
            {"type": "experience", "heading": "Places I have worked at", "text": None, "entries": [
                entry(title="volunteer", organization="Northgate Library", start="2019", end="2020",
                      bullets=["ran a coding club for teenagers"]),
            ]},
            {"type": "skills", "heading": "Stuff I know", "text": None, "entries": [entry(skills=["SQL", "Python", "Tableau", "Excel"])]},
            {"type": "education", "heading": "Where I studied", "text": None, "entries": [
                entry(organization="University of Leeds", title="BSc Mathematics", end="2020"),
            ]},
        ],
    }
    set_llm_for_tests(FakeLLM(output))
    result = import_text(source)
    assert result.method == "llm"
    assert result.resume.contact.full_name == "Sam Rivera"
    assert not any(w.startswith("No name was found.") for w in result.report.warnings)
    assert "No phone number was found." in result.report.warnings  # still true, so still reported
