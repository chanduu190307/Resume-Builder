"""The web app's TypeScript types are generated from shared/schema. If the
Python model changes without regenerating, the two sides silently disagree."""

from resume_engine import export_schema


def test_committed_schema_matches_model():
    assert export_schema.main(["--check"]) == 0, (
        "shared/schema is stale: run `python -m resume_engine.export_schema` "
        "and `npm run gen:types` in web/"
    )
