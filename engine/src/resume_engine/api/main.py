"""HTTP API for the resume engine.

The API is stateless by design: there are no accounts, and resumes are stored
only in the user's browser. Requests are processed and nothing is persisted.
Never log resume content.
"""

from __future__ import annotations

import base64
import binascii
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from typing import Literal

from pydantic import BaseModel, Field

from .. import __version__
from ..analysis import analyze
from ..analysis.models import AnalysisResult
from ..importer import ImportResult, import_file, import_text
from ..ingest import UnsupportedFile
from ..ingest.pdf import ScannedPdf
from ..ingest.sniff import MAX_BYTES
from ..jobs.contracts import FetchedJobOut, TailorResponse
from ..jobs.cover_letter import CoverLetter, draft_cover_letter, polish_cover_letter
from ..jobs.fetch import JobFetchError, fetch_job
from ..jobs.jd import JobAnalysis, analyze_job
from ..jobs.match import match
from ..jobs.rewrite import RewriteResult, suggest_rewrites
from ..enhance.ai import suggest_improvements
from ..enhance.general import suggest_general
from ..jobs.tailor import Suggestion, suggest
from ..llm import LLMError, get_llm, llm_status
from ..schema import SCHEMA_VERSION, Resume

app = FastAPI(title="Resume Engine", version=__version__)

_origins = os.environ.get("RESUME_ENGINE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    llm_available, llm_reason = llm_status()
    return {
        "status": "ok",
        "engine_version": __version__,
        "schema_version": SCHEMA_VERSION,
        "ai_available": llm_available,
        "ai_status": llm_reason,
    }


@app.post("/api/resume/validate", response_model=Resume)
def validate_resume(resume: Resume) -> Resume:
    """Validate a resume and return it normalised (missing ids/defaults filled in).

    Invalid payloads get FastAPI's standard 422 response listing every problem.
    """
    return resume


# ----------------------------------------------------------------------------- import

class ImportResponse(BaseModel):
    resume: Resume
    source: str = Field(description="pdf | docx | text")
    method: str = Field(description="rules (deterministic parser) or llm")
    warnings: list[str]
    unplaced: list[str] = Field(description="Text that could not be placed; kept in a hidden section.")
    notes: list[str]
    extracted_text: str = Field(description="Normalised text as the parser saw it.")


class TextImportRequest(BaseModel):
    text: str = Field(max_length=60_000)
    mode: Literal["auto", "rules"] = "auto"


def _response(result: ImportResult) -> ImportResponse:
    return ImportResponse(
        resume=result.resume,
        source=result.source,
        method=result.method,
        warnings=result.report.warnings,
        unplaced=result.report.unplaced,
        notes=result.notes,
        extracted_text=result.extracted_text,
    )


def _error(err: UnsupportedFile) -> HTTPException:
    code = "scanned_pdf" if isinstance(err, ScannedPdf) else "unsupported"
    return HTTPException(status_code=422, detail={"code": code, "message": str(err)})


@app.post("/api/import/file", response_model=ImportResponse)
async def import_resume_file(file: UploadFile = File(...), mode: Literal["auto", "rules"] = Form("auto")) -> ImportResponse:
    """Import a PDF, DOCX or TXT resume. The file is processed in memory and not stored."""
    data = await file.read(MAX_BYTES + 1)
    try:
        return _response(import_file(data, file.filename or "", mode=mode))
    except UnsupportedFile as err:
        raise _error(err) from None


@app.post("/api/import/text", response_model=ImportResponse)
def import_resume_text(body: TextImportRequest) -> ImportResponse:
    """Import pasted resume text."""
    try:
        return _response(import_text(body.text, mode=body.mode))
    except UnsupportedFile as err:
        raise _error(err) from None


# ----------------------------------------------------------------------------- analysis

class AnalyzeRequest(BaseModel):
    resume: Resume
    pdf_base64: str | None = Field(default=None, description="The exported PDF, for the read-back test.", max_length=8_000_000)
    career_level: Literal["auto", "early", "experienced"] = "auto"


@app.post("/api/analyze", response_model=AnalysisResult)
def analyze_resume(body: AnalyzeRequest) -> AnalysisResult:
    """Quality Score, Parsing Readiness Score and checks. Deterministic; nothing is stored."""
    pdf = None
    if body.pdf_base64:
        try:
            pdf = base64.b64decode(body.pdf_base64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=422, detail={"code": "bad_pdf", "message": "The PDF data is not valid base64."}) from None
    return analyze(body.resume, pdf, level=body.career_level)


# ----------------------------------------------------------------------------- jobs

class FetchJobRequest(BaseModel):
    url: str = Field(max_length=2000)


class AnalyzeJobRequest(BaseModel):
    text: str = Field(min_length=1, max_length=40_000)
    title: str | None = None
    company: str | None = None


class MatchRequest(BaseModel):
    resume: Resume
    job: JobAnalysis


@app.post("/api/jobs/fetch", response_model=FetchedJobOut)
def fetch_job_description(body: FetchJobRequest) -> FetchedJobOut:
    """Import a job description from a public web page (SSRF-protected)."""
    try:
        job = fetch_job(body.url)
    except JobFetchError as err:
        raise HTTPException(status_code=422, detail={"code": "fetch_failed", "message": str(err)}) from None
    return FetchedJobOut(url=job.url, text=job.text, title=job.title, company=job.company, source=job.source)


@app.post("/api/jobs/analyze", response_model=JobAnalysis)
def analyze_job_description(body: AnalyzeJobRequest) -> JobAnalysis:
    """Extract requirements, skills, years and education from a job description (deterministic)."""
    return analyze_job(body.text, title=body.title, company=body.company)


@app.post("/api/jobs/match", response_model=TailorResponse)
def match_resume_to_job(body: MatchRequest) -> TailorResponse:
    """Job Match Score, keyword categories, requirement checks and truthful tailoring suggestions."""
    result = match(body.resume, body.job)
    return TailorResponse(match=result, suggestions=suggest(body.resume, body.job, result))


@app.post("/api/jobs/rewrite", response_model=RewriteResult)
def rewrite_for_job(body: MatchRequest) -> RewriteResult:
    """AI rewording for the job. Every proposal passes the truthfulness guard or is rejected with reasons."""
    llm = get_llm()
    if llm is None:
        _, reason = llm_status()
        raise HTTPException(status_code=422, detail={"code": "ai_unavailable", "message": reason})
    try:
        return suggest_rewrites(llm, body.resume, body.job, match(body.resume, body.job))
    except LLMError as err:
        raise HTTPException(status_code=502, detail={"code": "ai_failed", "message": str(err)}) from None


# ----------------------------------------------------------------------------- general enhancement

class EnhanceRequest(BaseModel):
    resume: Resume


class EnhanceResponse(BaseModel):
    suggestions: list[Suggestion]


@app.post("/api/enhance", response_model=EnhanceResponse)
def enhance_resume(body: EnhanceRequest) -> EnhanceResponse:
    """General improvements without a job: safe fixes, prompts for real numbers, and tips. Deterministic."""
    return EnhanceResponse(suggestions=suggest_general(body.resume))


@app.post("/api/enhance/rewrite", response_model=RewriteResult)
def enhance_with_ai(body: EnhanceRequest) -> RewriteResult:
    """AI clarity / grammar / spelling improvements; every proposal passes the truthfulness guard or is rejected."""
    llm = get_llm()
    if llm is None:
        _, reason = llm_status()
        raise HTTPException(status_code=422, detail={"code": "ai_unavailable", "message": reason})
    try:
        return suggest_improvements(llm, body.resume)
    except LLMError as err:
        raise HTTPException(status_code=502, detail={"code": "ai_failed", "message": str(err)}) from None


class CoverLetterRequest(BaseModel):
    resume: Resume
    job: JobAnalysis
    polish_with_ai: bool = False


@app.post("/api/jobs/cover-letter", response_model=CoverLetter)
def cover_letter(body: CoverLetterRequest) -> CoverLetter:
    """A cover letter draft assembled only from the resume and the job; optional AI polish behind the guard."""
    result = match(body.resume, body.job)
    draft = draft_cover_letter(body.resume, body.job, result)
    if not body.polish_with_ai:
        return CoverLetter(text=draft, method="draft")
    llm = get_llm()
    if llm is None:
        _, reason = llm_status()
        raise HTTPException(status_code=422, detail={"code": "ai_unavailable", "message": reason})
    try:
        return polish_cover_letter(llm, body.resume, body.job, draft)
    except LLMError as err:
        raise HTTPException(status_code=502, detail={"code": "ai_failed", "message": str(err)}) from None


# ----------------------------------------------------------------------------- web app (single-service hosting)
# Must stay last: it adds a catch-all GET route after every API route.
if os.environ.get("RESUME_ENGINE_WEB_DIST"):
    from pathlib import Path

    from .web import mount_web_app

    mount_web_app(app, Path(os.environ["RESUME_ENGINE_WEB_DIST"]))
