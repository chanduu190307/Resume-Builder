# Resume Builder - rules for AI-assisted development

Read `docs/PLAN.md` (what to build, current phase) and `docs/DECISIONS.md` (why) before changing code.

## Working rules
- Build **one phase at a time**. Only work on the current phase in `docs/PLAN.md`; stop at the end of
  a phase for user review. Tick checklist items only when they are implemented **and** tested.
- Do not guess library APIs. This project uses recent major versions (TypeScript 7, Vite 8,
  React 19, React Router 8, Vitest 5, Tailwind CSS 4, Pydantic 2.14, FastAPI 0.16x). Check the
  installed package (`node_modules`, `.venv`) or docs when unsure.
- Run the checks below before declaring anything done, and report failures honestly.

## Product rules (non-negotiable)
- **Never fabricate** skills, employers, titles, dates, degrees, certifications, projects, metrics or
  years of experience, not in code, prompts, fixtures-as-output or suggestions.
- Missing information is reported as a gap or asked of the user, never invented.
- Never silently drop user content. Never log resume or job-description content.
- The three scores (Quality, Parsing Readiness, Job Match) stay independent and explainable.

## Architecture
- `engine/` - Python package `resume_engine` (FastAPI, Pydantic). Stateless.
  - `schema/resume.py` - **canonical resume model, the single source of truth**
  - `evals/compare.py` - field-level accuracy harness
  - `ingest/` + `parse/` + `importer.py` - PDF/DOCX/text import (rules first, optional verified AI)
  - `analysis/` - Quality and Parsing Readiness scores, checks (deterministic)
  - `jobs/` - JD analysis, skills ontology, matching, tailoring suggestions, truthfulness guard, cover letter
  - `enhance/` - general improvements without a job
  - `llm/` - the only place that talks to an AI service: Groq only, free models with a fallback chain
    (D29, D30; `StructuredLLM` protocol; tests use fakes). No Anthropic code or key is used anywhere.
  - `api/main.py` - HTTP API (`/api/...`)
- `web/` - React + TypeScript + Tailwind v4. Data stored in the browser only.
  - `src/types/resume.generated.ts` - generated, never edit by hand
  - `src/lib/editor/` - pure reducer + undo history; all edits are `ResumeAction`s
  - `src/lib/document/buildDocument.ts` - resume -> document model (all content decisions)
  - `src/lib/render/` - PDF (react-pdf) and DOCX renderers; `fonts.ts` holds the fontkit fix (D13)
  - `src/lib/storage/` - IndexedDB (resumes, jobs, versions) and backups
  - `src/lib/tailor/applyOps.ts` - applies engine suggestion operations safely (refuses stale ones)
  - Design tokens in `src/index.css` (`bg-canvas`, `text-ink`, `border-line`, `accent`...);
    combine classes with `cn()` (tailwind-merge) so overrides win
  - `src/lib/motion/` + `src/components/motion/` - the only place for motion (D28): every effect must
    respect `prefers-reduced-motion`, never move form fields, and never hide content without JS
- `shared/schema/` - JSON Schema exported from the engine (generated)
- `fixtures/resumes/` - hand-labelled golden resumes (fictional people) used as ground truth

## Changing the resume model
1. Edit `engine/src/resume_engine/schema/resume.py`
2. `cd engine && .venv\Scripts\python -m resume_engine.export_schema`
3. `cd web && npm run gen:types`
4. Update fixtures if needed; run all checks.

## Checks
```powershell
cd engine; .venv\Scripts\python -m pytest
cd web; npm run check        # types drift + tsc + vitest (incl. real PDF/DOCX text extraction)
cd web; npm run e2e          # end-to-end in installed Chrome (dev server)
cd web; npm run e2e:prod     # end-to-end against the production build
```

## Accuracy
`cd engine; .venv\Scripts\python -m resume_engine.evals.import_report` prints import accuracy over the
rendered fixtures. After template changes run `cd web; npm run gen:rendered` and re-check.

## Run locally
```powershell
.\scripts\dev.ps1            # engine on :8000, web on :5173 (proxies /api)
```
