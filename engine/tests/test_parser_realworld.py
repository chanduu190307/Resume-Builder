"""Layouts seen in a real student resume (Indian format), rebuilt with a fictional person.

Each line mimics what the PDF reader produces: segments (left text / right-aligned column), font
size, boldness and left edge. Covers: an ALL-CAPS name, ALL-CAPS project titles, a numbered project
title, a bullet glyph laid out apart from its text, grades beside the degree, school entries
without a blank line between them, "Description:" sub-headings, and dateless certifications.
"""

from resume_engine.ingest import Line, Segment, normalize_lines
from resume_engine.parse.parser import parse_lines

HEADING = 13.9  # this document's real section headings


def L(*parts, size=11.0, bold=False, x0=36.0, page=1):
    return Line(segments=[Segment(p, bold=bold) for p in parts], size=size, x0=x0, page=page)


def H(text):
    return L(text, size=HEADING, bold=True, x0=35.0)


LINES = [
    L("PRIYA K", size=22.0, bold=True),
    L("Mysuru, Karnataka | +91 90000 00000 | priya.k@example.com |", size=12.0),
    L("www.linkedin.com/in/priya-k-example https://github.com/priya-k-example", size=12.0),
    H("Career Objective"),
    L("Aspiring software developer focused on building reliable web applications."),
    H("Education"),
    L("Example Institute of Technology, Mysuru", "Aug 2023 - Jun 2027", x0=41.0),
    L("B.E in Information Science", "CGPA: 8.1", x0=39.0),
    L("Example PU College, Mysuru", "Jun 2021 - Mar 2023", x0=39.0),
    L("12th Standard", "Percentage: 88.2", x0=39.0),
    L("Example Public School, Mysuru", "Jun 2020 - Mar 2021", x0=39.0),
    L("10th Standard", "Percentage: 91.4", x0=39.0),
    H("Projects"),
    L("CAMPUS CONNECT:", size=12.0, bold=True),
    L("Tech: React.js, Node.js, MongoDB", size=12.0, bold=True),
    L("Description:", size=12.0, bold=True),
    L("", "Built a notice board app used by student clubs to share events and", x0=90.0),
    L("announcements in one place.", x0=90.0),
    L("", "Added role-based access so club leads can approve posts.", x0=90.0),
    L("2. QUIZ ARENA", size=12.0, bold=True),
    L("Tech: Python, Flask, SQLite", size=12.0, bold=True),
    L("Description:", size=12.0, bold=True),
    L("• Created a timed quiz platform with a leaderboard.", x0=72.0),
    H("Certifications"),
    L("Python Basics", size=11.0, bold=True),
    L("Example Learning Academy", size=11.0),
    L("Web Development Fundamentals", size=11.0, bold=True),
    L("Example Online School", size=11.0),
    L("Cloud Basics | Example Cloud Academy", size=11.0, bold=True),
    L("Learned core cloud concepts including storage, compute and", size=11.0),
    L("basic security practices.", size=11.0),
    H("Personal Details"),
    L("Father’s Name : Ravi K", x0=38.0),
    L("Mother’s Name: Lakshmi R", x0=38.0),
    L("D.O.B : 15-08-2005", x0=38.0),
    L("Address : #12 1st Main Road, Mysuru", x0=38.0),
    H("Declaration"),
    L("I hereby declare that the above details are true to the best of my knowledge.", x0=38.0),
    L("Date :", bold=True, x0=38.0),
    L("Place : Mysuru", "Signature", x0=38.0),
    L("(PRIYA K)", x0=429.0),
]


def parse():
    resume, report = parse_lines(normalize_lines([Line(segments=list(l.segments), size=l.size, x0=l.x0) for l in LINES]))
    return resume, report


def section(resume, kind):
    return next(s for s in resume.sections if s.type == kind)


def test_all_caps_name_is_the_name_not_a_section():
    resume, report = parse()
    c = resume.contact
    assert (c.full_name, c.email, c.phone, c.location) == ("PRIYA K", "priya.k@example.com", "+91 90000 00000", "Mysuru, Karnataka")
    assert len(c.links) == 2
    assert not any(s.title.upper() == "PRIYA K" for s in resume.sections)
    assert not any(w.startswith("No name") for w in report.warnings)


def test_schools_without_spacing_are_separate_entries_with_grades():
    edu = section(parse()[0], "education").items
    assert [(e.institution, e.degree, e.grade) for e in edu] == [
        ("Example Institute of Technology, Mysuru", "B.E in Information Science", "CGPA: 8.1"),
        ("Example PU College, Mysuru", "12th Standard", "Percentage: 88.2"),
        ("Example Public School, Mysuru", "10th Standard", "Percentage: 91.4"),
    ]
    assert [(e.start.year, e.end.year) for e in edu] == [(2023, 2027), (2021, 2023), (2020, 2021)]


def test_caps_and_numbered_project_titles_glyph_bullets_and_description_labels():
    projects = section(parse()[0], "projects").items
    assert [p.name for p in projects] == ["CAMPUS CONNECT", "QUIZ ARENA"]
    assert projects[0].technologies == ["React.js", "Node.js", "MongoDB"]
    assert [b.text for b in projects[0].bullets] == [
        "Built a notice board app used by student clubs to share events and announcements in one place.",
        "Added role-based access so club leads can approve posts.",
    ]
    assert [b.text for b in projects[1].bullets] == ["Created a timed quiz platform with a leaderboard."]


def test_dateless_certifications_split_on_each_bold_title():
    certs = section(parse()[0], "certifications").items
    assert [(c.name, c.issuer) for c in certs] == [
        ("Python Basics", "Example Learning Academy"),
        ("Web Development Fundamentals", "Example Online School"),
        ("Cloud Basics", "Example Cloud Academy"),
    ]


def test_certification_description_is_kept_as_one_paragraph():
    certs = section(parse()[0], "certifications").items
    assert certs[2].description == "Learned core cloud concepts including storage, compute and basic security practices."
    assert certs[0].description is None


def custom(resume, title):
    return next(s for s in resume.sections if s.type == "custom" and s.title == title)


def test_personal_details_lines_are_kept_whole():
    """"D.O.B : 15-08-2005" used to lose its year to a date field and leave "D.O.B : 15-08" unplaced."""
    [item] = custom(parse()[0], "Personal Details").items
    assert [b.text for b in item.bullets] == [
        "Father’s Name : Ravi K",
        "Mother’s Name: Lakshmi R",
        "D.O.B : 15-08-2005",
        "Address: #12 1st Main Road, Mysuru",
    ]
    assert item.date_text is None and item.title == ""


def test_declaration_keeps_place_and_signature_on_one_line():
    """"Signature" on the right used to become a location, leaving "Place : ..." unplaced."""
    items = custom(parse()[0], "Declaration").items
    assert items[0].title == "I hereby declare that the above details are true to the best of my knowledge."
    assert items[0].location is None
    assert [b.text for b in items[0].bullets] == ["Date :", "Place : Mysuru Signature"]
    assert items[1].title == "(PRIYA K)"


def test_nothing_is_left_unplaced():
    _, report = parse()
    assert report.unplaced == []


def test_unknown_caps_heading_still_works_when_styled_like_real_headings():
    lines = [L("Test Person", size=20.0, bold=True), L("test@example.com"), H("Skills"), L("Python, SQL"),
             H("VOLUNTEERING ABROAD"), L("Taught English at a community centre.")]
    resume, _ = parse_lines(normalize_lines(lines))
    assert any(s.type == "custom" and s.title == "Volunteering Abroad" for s in resume.sections)
