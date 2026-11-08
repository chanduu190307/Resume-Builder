# Golden resumes

Hand-labelled ground truth for accuracy testing. **All people, contact details and most
organisations are fictional** (`example.com` emails, reserved phone ranges).

Each file is a valid canonical resume (`shared/schema/resume.input.schema.json`). From Phase 2,
each one is rendered to PDF / DOCX / TXT in several layouts, run through the parser, and compared
field-by-field with this file using `resume_engine.evals.compare`.

| File | Profile | Edge cases covered |
|---|---|---|
| `01_fresher_cs_student` | Final-year CS student, India | Objective instead of summary, internship section, year-only dates, custom "Extracurricular" section, percentages and CGPA |
| `02_senior_software_engineer` | 8 yrs backend, US | Current role, many metrics, expiring certification, URL without scheme, Letter page size |
| `03_career_changer_teacher_to_data` | Teacher moving to data, UK | Projects before experience, degree with only an end date, same institution twice, soft-skill group |
| `04_marketing_manager` | Non-tech, Spain | Accented characters, unnamed skill group, a weak bullet ("Responsible for social media."), languages |
| `05_registered_nurse` | Healthcare, US | No links, licenses with credential ids, certs with only an expiry date, ranges like "1-2 patients" |
| `06_graduate_researcher` | PhD candidate, Canada | Publications, awards, two concurrent current items, a hidden section |

Rules: keep them realistic, keep them fictional, and never "fix" a fixture to make a parser pass.
