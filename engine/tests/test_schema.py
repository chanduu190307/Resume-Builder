import pytest
from pydantic import ValidationError

from resume_engine.schema import (
    Bullet,
    ExperienceItem,
    ExperienceSection,
    PartialDate,
    Resume,
    SkillGroup,
)


def test_empty_resume_is_valid_and_gets_ids():
    resume = Resume()
    assert resume.schema_version == "1.0"
    assert resume.id
    assert resume.contact.full_name == ""
    assert resume.sections == []


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        Resume.model_validate({"contact": {"full_name": "A", "nickname": "x"}})


def test_sections_are_discriminated_by_type():
    resume = Resume.model_validate(
        {
            "sections": [
                {"type": "experience", "title": "Work", "items": [{"title": "Dev", "organization": "Acme"}]},
                {"type": "skills", "title": "Skills", "items": [{"skills": ["Python"]}]},
            ]
        }
    )
    assert isinstance(resume.sections[0], ExperienceSection)
    assert isinstance(resume.sections[0].items[0], ExperienceItem)
    assert isinstance(resume.sections[1].items[0], SkillGroup)


def test_unknown_section_type_is_rejected():
    with pytest.raises(ValidationError):
        Resume.model_validate({"sections": [{"type": "hobbies", "title": "Hobbies"}]})


@pytest.mark.parametrize("bad", [{"year": 1800}, {"year": 2020, "month": 13}, {"year": 2020, "month": 0}])
def test_partial_date_ranges(bad):
    with pytest.raises(ValidationError):
        PartialDate.model_validate(bad)


def test_current_item_cannot_have_end_date():
    with pytest.raises(ValidationError):
        ExperienceItem(start=PartialDate(year=2020), end=PartialDate(year=2021), current=True)


def test_end_before_start_is_allowed_because_analysis_reports_it():
    # Content problems are reported by analysis, never rejected by the schema.
    item = ExperienceItem(start=PartialDate(year=2022), end=PartialDate(year=2020))
    assert item.end.year == 2020


def test_malformed_email_is_preserved_not_rejected():
    resume = Resume.model_validate({"contact": {"email": "not-an-email"}})
    assert resume.contact.email == "not-an-email"


def test_duplicate_ids_are_rejected():
    with pytest.raises(ValidationError, match="duplicate ids"):
        Resume.model_validate(
            {
                "sections": [
                    {
                        "type": "experience",
                        "title": "Work",
                        "items": [
                            {"id": "same", "bullets": [{"id": "same", "text": "x"}]},
                        ],
                    }
                ]
            }
        )


def test_bullet_origin_defaults_to_user_and_is_restricted():
    assert Bullet(text="Did a thing").origin == "user"
    assert Bullet(text="Did a thing", origin="ai_assisted").origin == "ai_assisted"
    with pytest.raises(ValidationError):
        Bullet(text="x", origin="invented")


def test_text_is_never_modified():
    raw = "  Led   a team\tof 4 — shipped v2  "
    assert Bullet(text=raw).text == raw
