from resume_engine.importer import import_text
from resume_engine.parse import contact as C
from resume_engine.parse.headings import display_title, heading_type
from resume_engine.parse.parser import UNSORTED_TITLE, join_wrapped, split_top_level
from resume_engine.ingest import Line, Segment


def sections(resume, kind):
    return [s for s in resume.sections if s.type == kind]


def items(resume, kind):
    return [i for s in sections(resume, kind) for i in s.items]


# ---------------------------------------------------------------- contact helpers

def test_phone_detection_ignores_year_ranges():
    assert C.find_phones("+1 (555) 010-0142") == ["+1 (555) 010-0142"]
    assert C.find_phones("+91 90000 00001") == ["+91 90000 00001"]
    assert C.find_phones("2012 – 2016") == []
    assert C.find_phones("3M requests") == []


def test_url_detection_ignores_emails_and_abbreviations():
    assert C.find_urls("a@b.com | linkedin.com/in/x | https://site.dev/p") == ["linkedin.com/in/x", "https://site.dev/p"]
    assert C.find_urls("Node.js, B.S., e.g. React") == []


def test_locations():
    assert C.is_strict_location("Austin, TX") and C.is_strict_location("Madrid, Spain") and C.is_strict_location("Remote")
    assert not C.is_strict_location("Registered Nurse, BSN")
    assert C.split_trailing_location("Contoso Payments Austin, TX") == ("Contoso Payments", "Austin, TX")
    assert C.split_trailing_location("Acme Corp New York, NY") == ("Acme Corp", "New York, NY")
    assert C.split_trailing_location("Northwind Labs Remote") == ("Northwind Labs", "Remote")


# ---------------------------------------------------------------- headings

def heading(text):
    return heading_type(Line(segments=[Segment(text)]))


def test_headings():
    assert heading("PROFESSIONAL EXPERIENCE") == "experience"
    assert heading("Licenses & Certifications") == "certifications"
    assert heading("Career Objective") == "summary"
    assert heading("VOLUNTEERING") == "experience"
    assert heading("MILITARY SERVICE") == "custom"  # unknown but clearly a heading
    assert heading("AWS, GCP") is None
    assert heading("Software Engineer") is None
    assert heading("Technologies: Go, Kafka") is None
    assert display_title("PROFESSIONAL EXPERIENCE") == "Professional Experience"
    assert display_title("LICENSES & CERTIFICATIONS") == "Licenses & Certifications"
    assert display_title("Data Projects") == "Data Projects"


# ---------------------------------------------------------------- text helpers

def test_join_wrapped_keeps_hyphenated_compounds():
    assert join_wrapped(["migrated to event-", "driven services"]) == "migrated to event-driven services"
    assert join_wrapped(["Led a team", "of five"]) == "Led a team of five"


def test_split_top_level_respects_parentheses():
    assert split_top_level("Python (pandas, NumPy), SQL; Git") == ["Python (pandas, NumPy)", "SQL", "Git"]


# ---------------------------------------------------------------- whole-resume behaviour

RESUME = """Jane Doe
Data Analyst
jane.doe@example.com | +44 7700 900123 | Leeds, UK | github.com/janedoe

PROFILE
Analyst with 4 years of experience turning messy data into decisions.

WORK HISTORY
Acme Corp | Data Analyst | Jan 2021 – Present
- Built weekly KPI dashboards in Power BI for 6 regional teams.
- Automated data cleaning in Python, saving 5 hours a week.
Tools: Python, SQL, Power BI

Junior Analyst at Globex Ltd | 2019 – 2020
- Maintained Excel reports.

SKILLS
Languages: Python, SQL, R
Python (pandas, NumPy), Tableau

LANGUAGES
English (Native), French – Intermediate, German: Basic

HOBBIES
Chess and hill walking
"""


def test_full_text_resume():
    resume, report = import_text(RESUME).resume, import_text(RESUME).report
    c = resume.contact
    assert (c.full_name, c.headline, c.email, c.phone, c.location) == (
        "Jane Doe", "Data Analyst", "jane.doe@example.com", "+44 7700 900123", "Leeds, UK",
    )
    assert [l.url for l in c.links] == ["github.com/janedoe"]

    [summary] = items(resume, "summary")
    assert summary.text.startswith("Analyst with 4 years")

    first, second = items(resume, "experience")
    # Company written first is recognised and swapped into the right fields.
    assert (first.title, first.organization, first.current) == ("Data Analyst", "Acme Corp", True)
    assert first.technologies == ["Python", "SQL", "Power BI"]
    assert len(first.bullets) == 2
    assert (second.title, second.organization) == ("Junior Analyst", "Globex Ltd")
    assert (second.start.year, second.end.year) == (2019, 2020)

    skills = [s for g in items(resume, "skills") for s in g.skills]
    assert skills == ["Python", "SQL", "R", "Python (pandas, NumPy)", "Tableau"]

    langs = [(l.language, l.proficiency) for l in items(resume, "languages")]
    assert langs == [("English", "Native"), ("French", "Intermediate"), ("German", "Basic")]

    [hobby] = items(resume, "custom")
    assert hobby.title == "Chess and hill walking"
    assert report.unplaced == []


def test_unplaced_text_is_kept_in_a_hidden_section_and_reported():
    text = "Jane Doe\njane@example.com\nSome stray line ✦ that fits nowhere\nSKILLS\nPython"
    result = import_text(text)
    assert "Some stray line ✦ that fits nowhere" in result.report.unplaced
    [unsorted] = [s for s in result.resume.sections if s.title == UNSORTED_TITLE]
    assert unsorted.visible is False
    assert [b.text for b in unsorted.items[0].bullets] == ["Some stray line ✦ that fits nowhere"]
    assert any("could not be placed" in w for w in result.report.warnings)


def test_summary_without_heading_is_recognised():
    text = (
        "Jane Doe\njane@example.com\n"
        "Product designer with eight years of experience shipping consumer mobile apps used by millions.\n"
        "SKILLS\nFigma"
    )
    result = import_text(text)
    [summary] = items(result.resume, "summary")
    assert summary.text.startswith("Product designer")
    assert result.report.unplaced == []


def test_title_with_employment_words_is_kept_verbatim():
    text = "Jane Doe\nEXPERIENCE\nTutor (part-time) | 2017 – 2019\nSelf-employed · Freelance\n- Taught maths."
    [item] = items(import_text(text).resume, "experience")
    assert item.title == "Tutor (part-time)"
    assert item.organization == "Self-employed"
    assert item.employment_type == "freelance"


def test_missing_contact_details_are_warned():
    report = import_text("SKILLS\nPython").report
    assert any("No name" in w for w in report.warnings)
    assert any("No email" in w for w in report.warnings)


def test_parsing_is_deterministic():
    a = import_text(RESUME).resume.model_dump(exclude={"id"})
    b = import_text(RESUME).resume.model_dump(exclude={"id"})

    def strip_ids(x):
        if isinstance(x, dict):
            return {k: strip_ids(v) for k, v in x.items() if k != "id"}
        if isinstance(x, list):
            return [strip_ids(v) for v in x]
        return x

    assert strip_ids(a) == strip_ids(b)
