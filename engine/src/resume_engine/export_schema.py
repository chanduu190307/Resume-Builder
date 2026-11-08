"""Export the canonical resume model as JSON Schema for the web app.

Two schemas are written to ``shared/schema``:

* ``resume.input.schema.json``  - what the engine *accepts* (ids/defaults optional).
  Used to validate fixtures and imported data.
* ``resume.schema.json``        - what the engine *produces* (every field present).
  Used to generate the TypeScript ``Resume`` type.

Usage::

    python -m resume_engine.export_schema          # write files
    python -m resume_engine.export_schema --check  # fail if files are stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analysis.models import AnalysisResult
from .jobs.contracts import JobsContract
from .schema import Resume

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_DIR = REPO_ROOT / "shared" / "schema"


def render() -> dict[str, str]:
    def dump(model, mode: str) -> str:
        schema = model.model_json_schema(mode=mode)
        return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"

    return {
        "resume.input.schema.json": dump(Resume, "validation"),
        "resume.schema.json": dump(Resume, "serialization"),
        "analysis.schema.json": dump(AnalysisResult, "serialization"),
        "jobs.schema.json": dump(JobsContract, "serialization"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if schema files are out of date")
    args = parser.parse_args(argv)

    stale = []
    for name, content in render().items():
        path = SCHEMA_DIR / name
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == content:
            continue
        if args.check:
            stale.append(name)
        else:
            SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
            print(f"wrote {path.relative_to(REPO_ROOT)}")

    if stale:
        print(f"stale schema files: {stale}. Run: python -m resume_engine.export_schema", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
