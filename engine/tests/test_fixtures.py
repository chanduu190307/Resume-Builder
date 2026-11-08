"""The golden fixtures are ground truth for later accuracy tests, so they must
always be valid, round-trip losslessly, and compare perfectly with themselves."""

from conftest import FIXTURE_PATHS

from resume_engine.evals.compare import compare_resumes
from resume_engine.schema import Resume


def test_there_are_enough_fixtures():
    assert len(FIXTURE_PATHS) >= 6


def test_fixture_validates(fixture_data):
    Resume.model_validate(fixture_data)


def test_fixture_round_trips(fixture_data):
    resume = Resume.model_validate(fixture_data)
    again = Resume.model_validate_json(resume.model_dump_json())
    assert again == resume


def test_fixture_compares_perfectly_with_itself(fixture_data):
    a = Resume.model_validate(fixture_data)
    b = Resume.model_validate(fixture_data)  # different generated ids
    report = compare_resumes(a, b)
    assert report.accuracy == 1.0, report.summary()
    assert not report.missing_items and not report.extra_items
    assert report.scored > 20
