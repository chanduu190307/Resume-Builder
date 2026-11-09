"""The engine serving the built web app (single-service hosting on Render, D32)."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from resume_engine.api.web import mount_web_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "assets" / "pdf.worker.min-x.mjs").write_text("export {}", encoding="utf-8")
    (dist / "fonts").mkdir()
    (dist / "fonts" / "Carlito-Regular.ttf").write_bytes(b"\x00\x01")
    (tmp_path / "secret.txt").write_text("outside dist", encoding="utf-8")

    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    mount_web_app(app, dist)
    return TestClient(app)


def test_api_routes_still_win(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_unknown_api_path_is_a_404_not_the_app(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404 and "root" not in res.text


@pytest.mark.parametrize("path", ["/", "/import", "/resumes/abc123", "/tailor/xyz"])
def test_app_routes_get_index_html(client, path):
    res = client.get(path)
    assert res.status_code == 200 and "id=root" in res.text
    assert res.headers["cache-control"] == "no-cache"


def test_assets_are_served_with_the_right_type_and_long_cache(client):
    js = client.get("/assets/index-abc.js")
    assert js.status_code == 200 and js.headers["content-type"].startswith("text/javascript")
    assert "immutable" in js.headers["cache-control"]
    worker = client.get("/assets/pdf.worker.min-x.mjs")
    assert worker.headers["content-type"].startswith("text/javascript")  # module workers need a JS type
    font = client.get("/fonts/Carlito-Regular.ttf")
    assert font.status_code == 200 and font.headers["content-type"] == "font/ttf"


def test_files_outside_the_build_are_never_served(client):
    for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]:
        res = client.get(path)
        assert "outside dist" not in res.text


def test_missing_build_fails_fast(tmp_path):
    with pytest.raises(RuntimeError, match="index.html"):
        mount_web_app(FastAPI(), tmp_path / "nope")
