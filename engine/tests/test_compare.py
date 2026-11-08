from conftest import FIXTURE_PATHS, load_fixture

from resume_engine.evals.compare import compare_resumes, norm_phone, norm_text, norm_url
from resume_engine.schema import Resume


def _senior() -> dict:
    return load_fixture(next(p for p in FIXTURE_PATHS if "senior" in p.stem))


def test_normalisers():
    assert norm_text("  Hello   World. ") == "hello world"
    assert norm_text("ﬁnance") == "finance"  # ligature
    assert norm_phone("+1 (555) 010-0142") == "15550100142"
    assert norm_url("https://www.LinkedIn.com/in/x/") == "linkedin.com/in/x"


def test_item_order_does_not_matter():
    data = _senior()
    shuffled = _senior()
    exp = next(s for s in shuffled["sections"] if s["type"] == "experience")
    exp["items"].reverse()
    report = compare_resumes(Resume.model_validate(data), Resume.model_validate(shuffled))
    assert report.accuracy == 1.0, report.summary()


def test_detects_changed_field_and_missing_bullet():
    data = _senior()
    broken = _senior()
    broken["contact"]["email"] = "wrong@example.com"
    job = next(s for s in broken["sections"] if s["type"] == "experience")["items"][0]
    del job["bullets"][1]
    report = compare_resumes(Resume.model_validate(data), Resume.model_validate(broken))
    paths = {m.path for m in report.mismatches}
    assert "contact.email" in paths
    assert any(p.startswith("experience[0].bullets") for p in paths)
    assert report.accuracy < 1.0


def test_invented_data_is_penalised():
    data = _senior()
    invented = _senior()
    invented["contact"]["headline"] = None
    data["contact"]["headline"] = None
    skills = next(s for s in invented["sections"] if s["type"] == "skills")
    skills["items"][0]["skills"].append("Rust")
    report = compare_resumes(Resume.model_validate(data), Resume.model_validate(invented))
    assert any(m.path == "skills[Rust]" and m.expected is None for m in report.mismatches)


def test_missing_item_is_reported_and_costs_its_fields():
    data = _senior()
    fewer = _senior()
    exp = next(s for s in fewer["sections"] if s["type"] == "experience")
    exp["items"].pop()
    report = compare_resumes(Resume.model_validate(data), Resume.model_validate(fewer))
    assert len(report.missing_items) == 1
    assert "tailspin" in report.missing_items[0]
    assert report.accuracy < 1.0


def test_whitespace_and_case_differences_are_tolerated():
    data = _senior()
    noisy = _senior()
    noisy["contact"]["full_name"] = "  MARCUS   bennett "
    report = compare_resumes(Resume.model_validate(data), Resume.model_validate(noisy))
    assert report.accuracy == 1.0, report.summary()
