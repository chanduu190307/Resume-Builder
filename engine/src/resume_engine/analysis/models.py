"""Result models for resume analysis. Every point awarded or lost has a reason."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel as _PydanticModel, ConfigDict, Field


class BaseModel(_PydanticModel):
    # In output schemas every field is always present (drives the generated TypeScript types).
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


Status = Literal["good", "fair", "poor", "not_measured"]
Severity = Literal["error", "warning", "info"]


class Ref(BaseModel):
    """Where in the resume an issue is, so the UI can jump to it."""

    section_id: str | None = None
    item_id: str | None = None
    bullet_id: str | None = None
    field: str | None = None


class Criterion(BaseModel):
    id: str
    label: str
    points: float
    max_points: float
    status: Status
    explanation: str = Field(description="Why this score: what was measured and what was found.")
    tips: list[str] = Field(default_factory=list)
    refs: list[Ref] = Field(default_factory=list)


class Category(BaseModel):
    id: str
    label: str
    score: float
    max_score: float
    criteria: list[Criterion]


class Score(BaseModel):
    total: int = Field(ge=0, le=100)
    band: Literal["Excellent", "Good", "Fair", "Needs work"]
    summary: str
    categories: list[Category]
    measured: bool = True


class Issue(BaseModel):
    id: str
    severity: Severity
    category: str
    message: str
    suggestion: str | None = None
    ref: Ref | None = None
    affects_score: bool = True


class Stats(BaseModel):
    words: int
    bullets: int
    quantified_bullets: int
    experience_months: int
    roles: int


class AnalysisResult(BaseModel):
    career_level: Literal["early", "experienced"]
    career_level_reason: str
    quality: Score
    parsing: Score
    issues: list[Issue]
    stats: Stats
    ats_text: str | None = Field(default=None, description="Plain text read back from the exported PDF.")


def band_for(total: int) -> Literal["Excellent", "Good", "Fair", "Needs work"]:
    if total >= 85:
        return "Excellent"
    if total >= 70:
        return "Good"
    if total >= 50:
        return "Fair"
    return "Needs work"


def status_for(points: float, max_points: float) -> Status:
    if max_points <= 0:
        return "not_measured"
    ratio = points / max_points
    return "good" if ratio >= 0.85 else "fair" if ratio >= 0.5 else "poor"
