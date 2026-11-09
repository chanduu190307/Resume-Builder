# Resume Builder

Create a professional, ATS-friendly resume and tailor it to any job description, truthfully.
Every suggestion is grounded in your real experience; nothing is invented.

> Status: **All phases (0-6) complete.** See [docs/PLAN.md](docs/PLAN.md).

## Features so far
- Create and manage multiple resumes, saved automatically in your browser
- Guided editor for every section, with undo/redo and reordering
- Three ATS-friendly templates, A4 or Letter, with a live preview of the exact PDF
- PDF and DOCX export with real, machine-readable text
- Backup / restore and "delete all my data"
- Import an existing resume (PDF, DOCX, TXT or pasted text) with a review step
- Analysis: Resume Quality and Parsing Readiness scores with explained criteria, checks and an ATS text view
- Tailor to a job: Job Match Score, keyword categories, requirements checklist, truthful suggestions on a copy
- Improve (no job needed): safe fixes, prompts for real numbers, optional AI wording behind a truthfulness guard
- Version history, an application tracker, and truthful cover letter drafts

## Optional: AI features
Copy `engine/.env.example` to `engine/.env` and set `GROQ_API_KEY` (free at console.groq.com). AI is
Groq only, using free models: if one model is rate limited or busy, the next free model is used. No
Anthropic/Claude key is used. Without a key everything still works; AI only assists with unusual
layouts and the optional rewording / polish features. Groq models read text only, so scanned
(image-only) PDFs cannot be read.

## Deploy on Render (free)
`render.yaml` describes one free web service: it builds the web app, installs the engine, and the engine
serves both the API and the app from one URL (no CORS setup needed).
1. Render Dashboard > **New > Blueprint** > connect `chanduu190307/Resume-Builder` (or open
   https://render.com/deploy?repo=https://github.com/chanduu190307/Resume-Builder).
2. Enter `GROQ_API_KEY` when asked, then **Apply**. Every push to `main` redeploys.
Free services sleep after 15 minutes without traffic; the first request then takes about a minute.
GitHub Actions (`.github/workflows/ci.yml`) runs all tests and the same build/start as Render on every push.

## Requirements
- Python 3.12+ (developed on 3.14)
- Node.js 22+ (developed on 24)

## Setup
```powershell
# Engine
cd engine
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"

# Web
cd ..\web
npm install
```

## Run
```powershell
.\scripts\dev.ps1
```
Opens the engine at http://127.0.0.1:8000 and the web app at http://localhost:5173.

## Test
```powershell
cd engine; .venv\Scripts\python -m pytest
cd web; npm run check      # unit + export tests
cd web; npm run e2e        # end-to-end + accessibility tests (uses your installed Chrome; starts the engine)
```

## Project layout
| Path | What |
|---|---|
| `engine/` | Python engine: resume model, parsing, analysis, enhancement, API |
| `web/` | React web app |
| `shared/schema/` | JSON Schema generated from the engine's resume model |
| `fixtures/resumes/` | Hand-labelled golden resumes (fictional) for accuracy testing |
| `docs/` | Plan and design decisions |

## Privacy
No accounts. Resumes are stored only in your browser. The engine is stateless and does not store
or log resume content.
