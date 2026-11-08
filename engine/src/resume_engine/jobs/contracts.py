"""API response models for the jobs feature (also exported for TypeScript)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .cover_letter import CoverLetter
from .jd import JobAnalysis
from .match import MatchResult
from .rewrite import RewriteResult
from .tailor import Suggestion


class _Model(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class FetchedJobOut(_Model):
    url: str
    text: str
    title: str | None
    company: str | None
    source: str


class TailorResponse(_Model):
    match: MatchResult
    suggestions: list[Suggestion]


class JobsContract(_Model):
    """Not an endpoint: bundles every jobs type so one TypeScript file can be generated."""

    analysis: JobAnalysis
    tailor: TailorResponse
    rewrite: RewriteResult
    fetched: FetchedJobOut
    cover_letter: CoverLetter
