import pytest

from resume_engine.parse.dates import find_cert_dates, find_range, parse_single, remove_span
from resume_engine.schema import PartialDate


def d(year, month=None):
    return PartialDate(year=year, month=month)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Jun 2025", d(2025, 6)),
        ("June 2025", d(2025, 6)),
        ("Sept. 2021", d(2021, 9)),
        ("Sep 2021", d(2021, 9)),
        ("06/2025", d(2025, 6)),
        ("6/2025", d(2025, 6)),
        ("2025-06", d(2025, 6)),
        ("2019", d(2019)),
        ("Summer 2021", d(2021)),
        ("13/2025", None),
        ("hello", None),
    ],
)
def test_parse_single(text, expected):
    assert parse_single(text) == expected


@pytest.mark.parametrize(
    "text, start, end, current, rest",
    [
        ("Senior Software Engineer Mar 2021 – Present", d(2021, 3), None, True, "Senior Software Engineer"),
        ("Software Engineer II | Jan 2018 – Feb 2021", d(2018, 1), d(2021, 2), False, "Software Engineer II"),
        ("B.S., Computer Science 2012 – 2016", d(2012), d(2016), False, "B.S., Computer Science"),
        ("Analyst (06/2019 - 08/2020)", d(2019, 6), d(2020, 8), False, "Analyst"),
        ("Intern, June 2023 to August 2023", d(2023, 6), d(2023, 8), False, "Intern"),
        ("Engineer 2020 - Current", d(2020), None, True, "Engineer"),
        ("Engineer since 2021", d(2021), None, True, "Engineer"),
        ("PGCE 2019", None, d(2019), False, "PGCE"),
    ],
)
def test_find_range(text, start, end, current, rest):
    m = find_range(text)
    assert m is not None
    assert (m.start, m.end, m.current) == (start, end, current)
    assert remove_span(text, m.span) == rest


@pytest.mark.parametrize("text", ["Built the API serving 3M requests per day.", "Mentored 4 engineers", "C++ and 2 terms", "Fixed 15 bugs"])
def test_no_false_dates(text):
    assert find_range(text) is None


def test_cert_dates():
    issued, expires, span, _ = find_cert_dates("CKAD May 2022 – Expires May 2025")
    assert (issued, expires) == (d(2022, 5), d(2025, 5))
    issued, expires, _, _ = find_cert_dates("ACLS Expires Sep 2026")
    assert (issued, expires) == (None, d(2026, 9))
    issued, expires, _, _ = find_cert_dates("CCRN 2022")
    assert (issued, expires) == (d(2022), None)
    assert find_cert_dates("Registered Nurse (RN) License") is None
