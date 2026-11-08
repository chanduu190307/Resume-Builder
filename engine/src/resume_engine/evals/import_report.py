"""Import accuracy over the rendered fixtures.

    python -m resume_engine.evals.import_report

Each golden fixture was rendered (web: `npm run gen:rendered`) to several
formats and layouts. Every file is imported and compared field by field with
what the document actually shows ("printable" expected: hidden sections and
values the templates never print are removed, since no parser could recover them).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ..importer import ImportResult, import_file
from ..parse.parser import UNSORTED_TITLE
from ..schema import Resume
from .compare import ComparisonReport, compare_resumes

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES = REPO_ROOT / "fixtures" / "resumes"
RENDERED = REPO_ROOT / "fixtures" / "rendered"


def printable(resume: Resume) -> Resume:
    """What a rendered document of this resume actually contains."""
    copy = resume.model_copy(deep=True)
    copy.sections = [s for s in copy.sections if s.visible]
    for section in copy.sections:
        if section.type == "experience":
            for item in section.items:
                # Templates print employment type except full-time / other.
                if item.employment_type in ("full_time", "other"):
                    item.employment_type = None
    return copy


def without_unsorted(resume: Resume) -> Resume:
    copy = resume.model_copy(deep=True)
    copy.sections = [s for s in copy.sections if not (s.type == "custom" and s.title == UNSORTED_TITLE)]
    return copy


def load_expected(fixture: str) -> Resume:
    return printable(Resume.model_validate(json.loads((FIXTURES / f"{fixture}.json").read_text(encoding="utf-8"))))


@dataclass
class FileResult:
    file: str
    variant: str
    result: ImportResult
    comparison: ComparisonReport


def variant_of(filename: str) -> str:
    return filename.split(".")[1]


def evaluate(path: Path) -> FileResult:
    fixture = path.name.split(".")[0]
    result = import_file(path.read_bytes(), path.name)
    comparison = compare_resumes(load_expected(fixture), without_unsorted(result.resume))
    return FileResult(path.name, variant_of(path.name), result, comparison)


def rendered_files() -> list[Path]:
    return sorted(p for p in RENDERED.iterdir() if p.suffix in (".pdf", ".docx", ".txt"))


def main() -> None:
    results = [evaluate(p) for p in rendered_files()]
    print(f"{'file':52} {'accuracy':>9} {'fields':>9} {'unplaced':>9}")
    for r in results:
        c = r.comparison
        print(f"{r.file:52} {c.accuracy:>8.1%} {c.correct:>4}/{c.scored:<4} {len(r.result.report.unplaced):>9}")
    print("\nBy format / layout:")
    groups: dict[str, list[FileResult]] = {}
    for r in results:
        key = r.variant if r.variant in ("twocol", "paste", "plain") else "template." + r.file.rsplit(".", 1)[1]
        groups.setdefault(key, []).append(r)
    for key, rs in sorted(groups.items()):
        correct = sum(r.comparison.correct for r in rs)
        scored = sum(r.comparison.scored for r in rs)
        print(f"  {key:16} {correct / scored:>7.1%}  ({correct}/{scored} fields, {len(rs)} files)")
    correct = sum(r.comparison.correct for r in results)
    scored = sum(r.comparison.scored for r in results)
    print(f"\nOverall: {correct / scored:.1%} ({correct}/{scored} fields, {len(results)} files)")


if __name__ == "__main__":
    main()
