import json
from pathlib import Path

import pytest

from resume_engine.llm.client import reset_llm, set_llm_for_tests

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "fixtures" / "resumes"
FIXTURE_PATHS = sorted(FIXTURE_DIR.glob("*.json"))


def load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(params=FIXTURE_PATHS, ids=lambda p: p.stem)
def fixture_data(request) -> dict:
    return load_fixture(request.param)


@pytest.fixture(autouse=True)
def no_real_llm():
    """Tests never call the real AI service: AI is 'unavailable' unless a test installs a fake."""
    set_llm_for_tests(None)
    yield
    reset_llm()
