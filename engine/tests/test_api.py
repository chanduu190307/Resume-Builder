from fastapi.testclient import TestClient

from conftest import FIXTURE_PATHS, load_fixture
from resume_engine.api.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["schema_version"] == "1.0"


def test_validate_fills_ids_and_defaults():
    data = load_fixture(FIXTURE_PATHS[0])
    res = client.post("/api/resume/validate", json=data)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"]
    assert all(section["id"] for section in body["sections"])
    assert body["contact"]["full_name"] == data["contact"]["full_name"]


def test_validate_rejects_bad_payload_with_details():
    res = client.post("/api/resume/validate", json={"sections": [{"type": "hobbies", "title": "x"}]})
    assert res.status_code == 422
    assert res.json()["detail"]


def test_import_file_pdf():
    from resume_engine.evals.import_report import RENDERED

    path = RENDERED / "02_senior_software_engineer.classic.pdf"
    res = client.post("/api/import/file", files={"file": (path.name, path.read_bytes(), "application/pdf")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "pdf" and body["method"] == "rules"
    assert body["resume"]["contact"]["full_name"] == "Marcus Bennett"
    assert body["unplaced"] == []
    assert "Contoso Payments" in body["extracted_text"]


def test_import_text():
    res = client.post("/api/import/text", json={"text": "Jane Doe\njane@example.com\nSKILLS\nPython, SQL"})
    assert res.status_code == 200, res.text
    assert res.json()["resume"]["contact"]["email"] == "jane@example.com"


def test_import_rejects_unsupported_with_readable_message():
    res = client.post("/api/import/file", files={"file": ("x.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 64, "application/msword")})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "unsupported"
    assert ".doc" in res.json()["detail"]["message"]


def test_import_scanned_pdf_has_specific_code():
    from test_ingest import MINIMAL_EMPTY_PDF

    res = client.post("/api/import/file", files={"file": ("scan.pdf", MINIMAL_EMPTY_PDF, "application/pdf")})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "scanned_pdf"


def test_analyze_endpoint_with_pdf():
    import base64

    from resume_engine.evals.import_report import RENDERED

    data = load_fixture(next(p for p in FIXTURE_PATHS if p.stem.startswith("02")))
    pdf = (RENDERED / "02_senior_software_engineer.classic.pdf").read_bytes()
    res = client.post("/api/analyze", json={"resume": data, "pdf_base64": base64.b64encode(pdf).decode()})
    assert res.status_code == 200, res.text
    body = res.json()
    assert 0 <= body["quality"]["total"] <= 100 and body["parsing"]["measured"] is True
    assert body["career_level"] == "experienced"
    assert "Contoso Payments" in body["ats_text"]


def test_analyze_rejects_bad_base64():
    data = load_fixture(FIXTURE_PATHS[0])
    res = client.post("/api/analyze", json={"resume": data, "pdf_base64": "not base64!!"})
    assert res.status_code == 422


def _job_text():
    from conftest import REPO_ROOT

    return (REPO_ROOT / "fixtures" / "jobs" / "backend_engineer.txt").read_text(encoding="utf-8")


def test_jobs_analyze_and_match():
    job = client.post("/api/jobs/analyze", json={"text": _job_text()})
    assert job.status_code == 200, job.text
    assert job.json()["years_required"] == 5
    data = load_fixture(next(p for p in FIXTURE_PATHS if p.stem.startswith("02")))
    res = client.post("/api/jobs/match", json={"resume": data, "job": job.json()})
    assert res.status_code == 200, res.text
    body = res.json()
    assert 0 <= body["match"]["score"]["total"] <= 100
    assert any(s["kind"] == "use_job_wording" for s in body["suggestions"])


def test_jobs_rewrite_without_ai_is_explained():
    job = client.post("/api/jobs/analyze", json={"text": _job_text()}).json()
    data = load_fixture(FIXTURE_PATHS[0])
    res = client.post("/api/jobs/rewrite", json={"resume": data, "job": job})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "ai_unavailable"


def test_jobs_fetch_blocks_private_addresses():
    res = client.post("/api/jobs/fetch", json={"url": "http://127.0.0.1/admin"})
    assert res.status_code == 422 and "private or local" in res.json()["detail"]["message"]


def test_cover_letter_endpoint():
    job = client.post("/api/jobs/analyze", json={"text": _job_text()}).json()
    data = load_fixture(next(p for p in FIXTURE_PATHS if p.stem.startswith("02")))
    res = client.post("/api/jobs/cover-letter", json={"resume": data, "job": job})
    assert res.status_code == 200 and res.json()["method"] == "draft"
    assert "Northbridge Finance" in res.json()["text"]
    res = client.post("/api/jobs/cover-letter", json={"resume": data, "job": job, "polish_with_ai": True})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "ai_unavailable"
