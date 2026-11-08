"""Import accuracy on rendered golden fixtures (see resume_engine.evals.import_report).

Thresholds are set just below measured accuracy so any regression fails CI.
Regenerate the rendered files with `npm run gen:rendered` (web) after template changes.
"""

import pytest

from resume_engine.evals.compare import compare_resumes
from resume_engine.evals.import_report import evaluate, rendered_files, without_unsorted
from resume_engine.importer import import_file

FILES = rendered_files()

# Minimum field accuracy per variant. Pasted text loses layout, so a location glued to a
# school name without a comma ("Sample PU College Mysuru") is genuinely ambiguous there.
THRESHOLDS = {"paste": 0.93}
DEFAULT_THRESHOLD = 0.99


def test_rendered_fixtures_exist():
    assert len(FILES) >= 54, "run `npm run gen:rendered` in web/"


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_import_accuracy(path):
    r = evaluate(path)
    threshold = THRESHOLDS.get(r.variant, DEFAULT_THRESHOLD)
    assert r.comparison.accuracy >= threshold, r.comparison.summary()


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_nothing_unplaced_from_known_layouts(path):
    r = evaluate(path)
    assert r.result.report.unplaced == []


def test_overall_accuracy():
    results = [evaluate(p) for p in FILES]
    correct = sum(r.comparison.correct for r in results)
    scored = sum(r.comparison.scored for r in results)
    assert correct / scored >= 0.995


@pytest.mark.parametrize("fixture", sorted({p.name.split(".")[0] for p in FILES}))
def test_same_resume_same_result_across_formats(fixture):
    """PDF, DOCX and a plain-text version of the same resume must import identically."""
    by_name = {p.name: p for p in FILES}
    reference = without_unsorted(import_file(by_name[f"{fixture}.classic.pdf"].read_bytes()).resume)
    for variant in ("classic.docx", "modern.pdf", "compact.pdf", "plain.txt", "twocol.pdf"):
        other = without_unsorted(import_file(by_name[f"{fixture}.{variant}"].read_bytes()).resume)
        report = compare_resumes(reference, other)
        assert report.accuracy == 1.0, f"{variant}: {report.summary()}"
