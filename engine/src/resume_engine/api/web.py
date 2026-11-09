"""Serve the built web app (web/dist) from the engine, for single-service hosting (D32).

Enabled only when RESUME_ENGINE_WEB_DIST points at the build output. Then one server answers both
the API (/api/...) and the app, so the browser talks to the same origin: no CORS and no
VITE_API_BASE needed. Locally (scripts/dev.ps1) it stays off and Vite serves the app.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Linux images do not always know these; a module script served as application/octet-stream is
# refused by browsers (the PDF preview's pdf.js worker is an .mjs file).
for _type, _ext in (("text/javascript", ".js"), ("text/javascript", ".mjs"), ("text/css", ".css"),
                    ("application/wasm", ".wasm"), ("font/ttf", ".ttf"), ("font/woff2", ".woff2"),
                    ("image/svg+xml", ".svg"), ("application/json", ".json")):
    mimetypes.add_type(_type, _ext)

_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}  # hashed file names
_REVALIDATE = {"Cache-Control": "no-cache"}


def mount_web_app(app: FastAPI, dist: Path) -> None:
    """Register a catch-all GET route. Call after every API route has been added."""
    root = dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"RESUME_ENGINE_WEB_DIST={dist} has no index.html; build the web app first.")

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")  # unknown API path: not the app
        if path:
            target = (root / path).resolve()
            if target.is_file() and target.is_relative_to(root):
                return FileResponse(target, headers=_IMMUTABLE if path.startswith("assets/") else _REVALIDATE)
        # Client-side routes (/import, /resumes/abc, /tailor/...) are handled by the app itself.
        return FileResponse(index, headers=_REVALIDATE)
