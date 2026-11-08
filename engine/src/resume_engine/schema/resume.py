"""Canonical resume model: the single source of truth for every feature.

Design rules (see docs/DECISIONS.md):

1. The schema enforces *structure*, not *quality*. An end date before a start
   date, a malformed email or a missing summary are content problems: the
   analysis engine reports them. The schema never rejects or drops user data
   because of them.
2. Free text that the enhancer may rewrite (bullets, summaries) carries an
   ``origin`` so the UI can always distinguish the user's own words from
   AI-assisted wording the user accepted.
3. Unknown fields are forbidden (``extra="forbid"``) so typos in fixtures,
   frontend payloads or LLM output fail loudly instead of being ignored.
4. Every item has a stable ``id`` so suggestions can target it precisely.
   IDs are generated when missing.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "1.0"

# Generous limits: they only exist to keep payloads sane, never to trim content.
SHORT = 300
MEDIUM = 1000
LONG = 5000


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class _Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        # In serialization schemas every field is always present, so mark it required.
        json_schema_serialization_defaults_required=True,
    )


IdField = Annotated[str, Field(default_factory=new_id, min_length=1, max_length=64)]

Origin = Literal["user", "ai_assisted"]
"""``user``: written or imported by the user. ``ai_assisted``: wording suggested
by the enhancer and explicitly accepted by the user."""


class PartialDate(_Model):
    """A date that may be known only to the year (``2021``) or year+month."""

    year: int = Field(ge=1900, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)


class _DateRange(_Model):
    start: PartialDate | None = None
    end: PartialDate | None = None
    current: bool = Field(default=False, description="True if this is ongoing ('Present').")

    @model_validator(mode="after")
    def _current_has_no_end(self) -> "_DateRange":
        if self.current and self.end is not None:
            raise ValueError("an item marked current cannot also have an end date")
        return self


class Bullet(_Model):
    id: IdField
    text: str = Field(max_length=MEDIUM)
    origin: Origin = "user"


# --------------------------------------------------------------------------- contact

LinkKind = Literal["linkedin", "github", "portfolio", "website", "other"]


class Link(_Model):
    id: IdField
    kind: LinkKind = "other"
    label: str | None = Field(default=None, max_length=SHORT)
    url: str = Field(max_length=MEDIUM)


class Contact(_Model):
    full_name: str = Field(default="", max_length=SHORT)
    headline: str | None = Field(
        default=None, max_length=SHORT, description="Professional title shown under the name."
    )
    email: str | None = Field(default=None, max_length=SHORT)
    phone: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=SHORT)
    links: list[Link] = Field(default_factory=list)


# --------------------------------------------------------------------------- items

class SummaryItem(_Model):
    id: IdField
    kind: Literal["summary", "objective"] = "summary"
    text: str = Field(max_length=LONG)
    origin: Origin = "user"


EmploymentType = Literal[
    "full_time", "part_time", "internship", "contract", "freelance", "volunteer", "other"
]


class ExperienceItem(_DateRange):
    id: IdField
    title: str = Field(default="", max_length=SHORT, description="Job title.")
    organization: str = Field(default="", max_length=SHORT, description="Company or organisation.")
    location: str | None = Field(default=None, max_length=SHORT)
    employment_type: EmploymentType | None = None
    technologies: list[str] = Field(default_factory=list)
    bullets: list[Bullet] = Field(default_factory=list)


class EducationItem(_DateRange):
    id: IdField
    institution: str = Field(default="", max_length=SHORT)
    degree: str | None = Field(default=None, max_length=SHORT)
    field_of_study: str | None = Field(default=None, max_length=SHORT)
    location: str | None = Field(default=None, max_length=SHORT)
    grade: str | None = Field(
        default=None, max_length=SHORT, description="Kept verbatim, e.g. 'CGPA 8.4/10' or '3.7 GPA'."
    )
    bullets: list[Bullet] = Field(default_factory=list)


class ProjectItem(_DateRange):
    id: IdField
    name: str = Field(default="", max_length=SHORT)
    role: str | None = Field(default=None, max_length=SHORT)
    organization: str | None = Field(
        default=None, max_length=SHORT, description="Company, course or club the project was for."
    )
    url: str | None = Field(default=None, max_length=MEDIUM)
    technologies: list[str] = Field(default_factory=list)
    bullets: list[Bullet] = Field(default_factory=list)


SkillKind = Literal["technical", "tool", "soft", "domain", "other"]


class SkillGroup(_Model):
    id: IdField
    name: str | None = Field(
        default=None, max_length=SHORT, description="Group label, e.g. 'Languages' or 'Cloud'."
    )
    kind: SkillKind = "technical"
    skills: list[Annotated[str, Field(min_length=1, max_length=SHORT)]] = Field(default_factory=list)


class CertificationItem(_Model):
    id: IdField
    name: str = Field(default="", max_length=SHORT)
    issuer: str | None = Field(default=None, max_length=SHORT)
    issued: PartialDate | None = None
    expires: PartialDate | None = None
    credential_id: str | None = Field(default=None, max_length=SHORT)
    url: str | None = Field(default=None, max_length=MEDIUM)


class PublicationItem(_Model):
    id: IdField
    title: str = Field(default="", max_length=MEDIUM)
    publisher: str | None = Field(default=None, max_length=SHORT)
    authors: str | None = Field(default=None, max_length=MEDIUM)
    date: PartialDate | None = None
    url: str | None = Field(default=None, max_length=MEDIUM)
    description: str | None = Field(default=None, max_length=LONG)


class LanguageItem(_Model):
    id: IdField
    language: str = Field(max_length=SHORT)
    proficiency: str | None = Field(
        default=None, max_length=SHORT, description="Kept verbatim, e.g. 'Native' or 'B2'."
    )


class AwardItem(_Model):
    id: IdField
    title: str = Field(default="", max_length=SHORT)
    issuer: str | None = Field(default=None, max_length=SHORT)
    date: PartialDate | None = None
    description: str | None = Field(default=None, max_length=LONG)


class CustomItem(_Model):
    id: IdField
    title: str = Field(default="", max_length=SHORT)
    subtitle: str | None = Field(default=None, max_length=SHORT)
    date_text: str | None = Field(
        default=None, max_length=SHORT, description="Free-form date text for unusual sections."
    )
    location: str | None = Field(default=None, max_length=SHORT)
    bullets: list[Bullet] = Field(default_factory=list)


# --------------------------------------------------------------------------- sections

SectionType = Literal[
    "summary",
    "experience",
    "education",
    "projects",
    "skills",
    "certifications",
    "publications",
    "languages",
    "awards",
    "custom",
]


class _SectionBase(_Model):
    id: IdField
    title: str = Field(max_length=SHORT, description="Heading shown on the resume; user-editable.")
    visible: bool = True


class SummarySection(_SectionBase):
    type: Literal["summary"] = "summary"
    items: list[SummaryItem] = Field(default_factory=list)


class ExperienceSection(_SectionBase):
    """Also used for internships and volunteering (see ``employment_type``)."""

    type: Literal["experience"] = "experience"
    items: list[ExperienceItem] = Field(default_factory=list)


class EducationSection(_SectionBase):
    type: Literal["education"] = "education"
    items: list[EducationItem] = Field(default_factory=list)


class ProjectsSection(_SectionBase):
    type: Literal["projects"] = "projects"
    items: list[ProjectItem] = Field(default_factory=list)


class SkillsSection(_SectionBase):
    type: Literal["skills"] = "skills"
    items: list[SkillGroup] = Field(default_factory=list)


class CertificationsSection(_SectionBase):
    type: Literal["certifications"] = "certifications"
    items: list[CertificationItem] = Field(default_factory=list)


class PublicationsSection(_SectionBase):
    type: Literal["publications"] = "publications"
    items: list[PublicationItem] = Field(default_factory=list)


class LanguagesSection(_SectionBase):
    type: Literal["languages"] = "languages"
    items: list[LanguageItem] = Field(default_factory=list)


class AwardsSection(_SectionBase):
    type: Literal["awards"] = "awards"
    items: list[AwardItem] = Field(default_factory=list)


class CustomSection(_SectionBase):
    type: Literal["custom"] = "custom"
    items: list[CustomItem] = Field(default_factory=list)


Section = Annotated[
    Union[
        SummarySection,
        ExperienceSection,
        EducationSection,
        ProjectsSection,
        SkillsSection,
        CertificationsSection,
        PublicationsSection,
        LanguagesSection,
        AwardsSection,
        CustomSection,
    ],
    Field(discriminator="type"),
]


# --------------------------------------------------------------------------- resume

class ResumeMeta(_Model):
    title: str = Field(default="Untitled resume", max_length=SHORT, description="Name of this resume version.")
    template: str = Field(default="classic", max_length=64)
    page_size: Literal["A4", "Letter"] = "A4"


class Resume(_Model):
    """A complete resume. Section order in ``sections`` is the display order."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: IdField
    meta: ResumeMeta = Field(default_factory=ResumeMeta)
    contact: Contact = Field(default_factory=Contact)
    sections: list[Section] = Field(default_factory=list)

    @model_validator(mode="after")
    def _ids_are_unique(self) -> "Resume":
        seen: set[str] = set()
        dupes: set[str] = set()

        def visit(node_id: str) -> None:
            (dupes if node_id in seen else seen).add(node_id)

        visit(self.id)
        for link in self.contact.links:
            visit(link.id)
        for section in self.sections:
            visit(section.id)
            for item in section.items:
                visit(item.id)
                for bullet in getattr(item, "bullets", []):
                    visit(bullet.id)
        if dupes:
            raise ValueError(f"duplicate ids in resume: {sorted(dupes)}")
        return self
