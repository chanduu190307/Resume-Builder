# Build Plan

Product: a web app for individual users to **create** resumes and **enhance** them,
generally or against a specific job description, without ever fabricating qualifications.

Decisions so far: web app, no accounts (data stays in the browser), cloud LLM allowed
(server-side only; Groq by default since D29, Claude optional), English first. Build strictly **one phase at a time**.
Each phase ends with passing checks and a user review before the next one starts.

Status legend: `[x]` done, `[ ]` to do.

---

## Phase 0 - Foundation (DONE)

- [x] Repository layout: `engine/` (Python), `web/` (React), `shared/schema/`, `fixtures/`, `docs/`
- [x] Canonical resume model (Pydantic): the single source of truth (`engine/src/resume_engine/schema/resume.py`)
- [x] JSON Schema export + drift check (`python -m resume_engine.export_schema [--check]`)
- [x] Generated TypeScript types + drift check (`npm run gen:types`, `npm run check`)
- [x] 6 hand-labelled golden resumes covering different careers and edge cases (`fixtures/resumes/`)
- [x] Accuracy harness: field-level comparison of expected vs actual resumes (`resume_engine.evals.compare`)
- [x] Stateless API skeleton: `/api/health`, `/api/resume/validate`
- [x] Web app shell, design tokens (calm premium minimal), engine status indicator
- [x] Engine tests (pytest) and web tests (vitest) passing

## Phase 1 - Resume Builder (DONE)

- [x] Browser storage (IndexedDB) for multiple resumes: create, rename, duplicate, delete
- [x] "Delete all my data" control (privacy by default)
- [x] Backup download / restore (validated against the engine schema; never overwrites)
- [x] Editor for contact details and every section type
- [x] Add / remove / rename / hide / reorder sections and items; reorder bullets
- [x] Bullet editing: Enter for next bullet, Backspace to remove empty, pasted lists split into bullets
- [x] Undo / redo (Ctrl+Z / Ctrl+Shift+Z) with typing grouped per field; autosave with status
- [x] Inline guidance per section (what good content looks like), with no auto-generated content
- [x] 3 ATS-friendly templates: Classic, Modern, Compact (single column, standard headings, real text)
- [x] Live preview with page breaks (A4 / Letter) that renders the exact exported PDF
- [x] PDF export (text-based, selectable, same bytes as preview)
- [x] DOCX export (same document model and template settings)
- [x] Responsive editor (desktop split view, mobile Edit / Preview tabs)
- [x] Tests: reducer, history, storage round-trip, backup, document model, and real PDF + DOCX
      text extraction for every fixture x every template; end-to-end tests in Chrome

## Phase 2 - Import & Extraction (DONE)

- [x] Upload PDF / DOCX / TXT, or paste text (file type detected from bytes, 5 MB limit, clear errors)
- [x] Layout-aware PDF extraction (segments, bold/italic, two-column detection, typographic wrap joining)
- [x] DOCX extraction (tables, list numbering, page header, text boxes, literal tabs)
- [x] Normalisation: Unicode, ligatures, invisible characters, bullet glyphs, whitespace, page furniture
      (conservative: removed only when on the same edge of every page, and reported)
- [x] Deterministic rule-based parser into the canonical model (contact, all section types, dates)
- [x] Fidelity: every line is placed or reported; unplaced text kept in a hidden "Imported text to review" section
- [x] Optional AI-assisted extraction (Claude, JSON-schema output) for unusual layouts, with every value
      verified against the document; scanned PDFs read by AI when a key is configured
- [x] Review screen: contact/sections overview, gaps highlighted, unplaced lines, extracted text, live preview
- [x] Eval corpus: 6 golden resumes x 9 renderings (3 templates x PDF/DOCX, pasted text, plain text,
      two-column) = 54 files. Measured field accuracy: **99.8%** overall; 100% on all PDF/DOCX/plain/two-column
      files; 98.2% on pasted text (remaining misses are genuinely ambiguous glued locations)
- [x] Cross-format consistency test: the same resume imports identically from PDF, DOCX, plain text and two-column
- [ ] Grow the corpus with real-world resumes (with permission) to measure accuracy beyond our own layouts

## Phase 3 - Analysis & Scores (DONE)

- [x] **Resume Quality Score**: fixed rubric (Completeness 20, Impact 25, Clarity 20, Consistency 15,
      Skills 10, Length 10); every criterion shows what was counted, its points and how to improve
- [x] **Parsing Readiness Score**: real round trip (exported PDF read back by our parser, field accuracy),
      standard headings (as printed by the chosen template), contact details, dates, plain text
- [x] **"What the ATS sees"**: the text read back from the exported PDF
- [x] **Consistency checks**: date logic, missing/mixed dates, tense (current roles may mix tenses), duplicates,
      weak phrasing, first person, passive voice, clichés, contact validity, skills duplicates/volume
- [x] Fairness: employment gaps, overlaps and personal details are information only and never lower a score
- [x] Career-stage aware targets (early career / experienced, auto-detected from work history, user can override)
- [x] Determinism (injectable date) and cross-format consistency test (PDF / DOCX / plain / pasted import: same score)
- [x] Editor Analysis panel: score cards, breakdowns, checks with "Go to" that focuses the exact field
- Note: grammar and spelling checking is done in Phase 5 (AI, verified), not by a word list, to avoid
  flagging names and technical terms; a dedicated "career changer" rubric was not added (early/experienced only)

## Phase 4 - Enhance with a Job Description (DONE)

- [x] Job description input: paste text, or **import from a link** (SSRF-protected; JSON-LD JobPosting first)
- [x] JD extraction (deterministic): title, company, required vs preferred vs responsibilities (heading and inline
      cues), skills, years, education level and "or equivalent", verbatim requirement text
- [x] Matching with meaning: curated skills ontology (236 skills, aliases, "implies" relations, case-sensitive
      common words) + multi-word stem matching + requirement text overlap; every status cites resume evidence
- [x] Keyword categories: present / equivalent wording / weak / possibly supported (implied) / missing
- [x] **Job Match Score** (required 35, preferred 15, experience 15, education 10, responsibilities 15,
      keywords 10), separate from quality and parsing scores, each part explained; unstated parts not counted
- [x] Truthful deterministic suggestions: use the job's wording (never downgrading), add skills your bullets
      already show, confirm-first for implied skills, reorder skills and bullets, gaps reported (never filled)
- [x] **Truthfulness guard** for AI rewording: rejects new numbers, skills, names, years claims, first person,
      runaway length; rejected proposals shown with reasons
- [x] **Guided achievement prompts**: verb-specific questions; the user types the real figure
- [x] Review UI: accept / edit / reject, "accept all wording & order changes", original vs tailored comparison
      with word-level diff, revert per change, restore original; tailoring always works on a copy
- Not done: AI-assisted JD extraction (the deterministic analyser handled every test job); embeddings
  (replaced by the ontology + stem matching, which is explainable)

## Phase 5 - General Enhancement (no job description) (DONE)

- [x] Editor "Improve" tab: suggestion cards with accept / edit / reject, dismissals remembered per resume
- [x] Safe deterministic fixes that only remove or re-inflect existing words: drop leading "I", past tense for
      roles you have left (current roles may mix tenses), remove exact duplicate bullets, dedupe skills
- [x] Prompts, never invented text: add a real number (verb-specific question), rewrite duty-style bullets yourself
- [x] Tips: missing / overlong summary, clichés, with "Show in resume"
- [x] Optional AI pass for clarity, grammar, spelling, action verbs and generic wording, behind the same
      truthfulness guard; rejected proposals listed with reasons

## Phase 6 - Versions & Polish (DONE)

- [x] **Version history**: automatic restore point before each editing session and before every restore,
      named versions kept permanently, restore never loses data (20 automatic points kept per resume)
- [x] **Application tracker** ("Applications"): every tailored job with status, applied date, last Job Match
      Score, notes, links to the tailored resume and job posting; filter by status; delete (optionally with resume)
- [x] **Truthful cover letter**: draft assembled only from the resume (summary, most relevant bullets as
      first-person sentences) and the job (title, company); optional AI polish behind the truthfulness guard;
      editable, saved with the job, copy / download
- [x] Backups (format v2) include applications and versions; v1 backups still restore; ids re-linked on conflict
- [x] Accessibility: axe WCAG 2.1 A/AA audit of every page and panel in the e2e suite (fixed: colour-contrast
      tokens, inline link underline, faded tags, an icon-only link without a name on mobile)
- [x] Responsive pass: compact header on phones, no horizontal overflow (checked at 390 px)
- [x] Privacy page; engine never logs resume or job content

## Phase 7 - UI Redesign: dynamic, but calm (BUILT - awaiting user review)

Goal: a modern, dynamic interface with depth and motion used only where it helps understanding or
delight. The editor stays still while typing. Easy to use comes first; effects never block a task (D28).

- [ ] Visual direction designed in Google Stitch ("Kinetic Solitude", `docs/redesign/stitch-home.png`) and
      approved by the user
- [x] New design tokens (indigo accent, warm canvas, glow colours, elevation, radius, easing, keyframes) in
      `src/index.css`; axe WCAG 2.1 AA audit passes on every page and panel
- [x] Motion foundation `src/lib/motion/motion.ts` (pointer depth, reveal-on-view, count-up): no-op under
      `prefers-reduced-motion`, pointer effects off on touch, content shown without IntersectionObserver
- [x] App shell: frosted glass header and editor toolbar, drifting background glows (cheap radial gradients),
      page transitions with React 19 `<ViewTransition>`
- [x] Home: layered hero with parallax chips and a 3D stack of resume pages that tilts toward the cursor;
      feature cards reveal on scroll
- [x] Scores: animated score rings (Quality, Parsing Readiness, Job Match, Applications list) and breakdown
      bars that fill when scrolled into view; real value in screen-reader text and `data-score`
- [x] Live preview: pages shown as a slight 3D stack that lies flat on hover/focus (mouse devices only)
- [x] Tabs and suggestion cards: sliding tab pill with arrow-key navigation (`SegmentedTabs`); accepted /
      rejected cards slide out (and come back if the change could not be applied)
- [x] Library (paper thumbnails, hover lift), Import (animated drop zone), Applications (score rings, empty
      state), Privacy restyled through the new tokens
- [x] PDF/DOCX templates unchanged; real PDF + DOCX text-extraction tests still pass
- [x] All checks pass: 331 engine tests, 110 web tests (7 new for motion/tabs/rings), 19 e2e in dev and
      in the production build, incl. axe audit and responsive layout at 360-1920 px
- Fixed along the way: the Vite dev server watched `e2e/.results`, so screenshots/traces written during
  tests stalled it (5-14 s page loads, flaky analysis timeouts). Now ignored; responsive suite 6.1 -> 2.0 min.

## Change requested during Phase 7 review - AI provider (DONE)

- [x] Use the project's Groq key instead of the machine's Claude key (D29): `GroqLLM` with strict JSON-schema
      output, explicit provider selection with no fallback, key in git-ignored `engine/.env`
- [x] Live-checked with the key: Improve AI pass, tailoring rewording, cover letter polish and AI-assisted import
- [x] Tests with a fake HTTP transport (request shape, errors, no resume text in logs, provider selection,
      all AI schemas valid for strict mode); Privacy page, README, `.env.example` updated
- [x] Groq sometimes rejects its own output (`json_validate_failed`) on the large import schema: retried once
- [x] Fixed (found in the live check, affected both providers): after an AI-assisted import, rules-stage
      "No name / email / phone was found" warnings stayed even when the AI found the value

## Full feature check with a real resume + Groq-only (DONE, 2026-11-09)

- [x] Groq only: Anthropic code path and dependency removed; free-model fallback chain with validation (D30)
- [x] Every feature exercised in Chrome with a real student resume and live Groq AI: import + review, editor,
      preview, 3 templates, page size, PDF/DOCX export, analysis + ATS text, Improve (rules + AI), accept/undo,
      version history, tailoring (match, accept, AI rewording, changes), cover letter (draft + AI polish +
      download), applications, library + backup, privacy: 22/22 steps pass, no browser or server errors
- [x] Import fixes found with that resume (D31): rules-only import went from empty contact / 16 unplaced lines
      to full contact, correct education with grades, both projects, all certifications, 9 unplaced lines
      (certification descriptions). Read-back of our own export: Parsing Readiness 62 -> 91
- [x] Tailoring bug fixed: "Data Structures & Algorithms" was rewritten to "data structures and algorithms &
      Algorithms"
- [x] Windows Smart App Control started blocking Tailwind's native engine on this PC (pages unstyled);
      `web/vite/tailwindScanFallback.ts` passes the class names to Tailwind when that happens (no effect elsewhere)
- [x] a11y e2e audits the settled page (reduced motion), fixing a flaky contrast reading mid-fade
- [ ] Certification descriptions need a field in the resume model (model change: proposed, not done)

## Hosting on Render (DONE, 2026-11-10) - https://resume-builder-g38k.onrender.com

- [x] `render.yaml`: one free web service; engine serves the web app (D32)
- [x] GitHub Actions on Linux: engine tests, web checks, Render build/start smoke test (run 42580060068: all green)
- [x] Live on Render: Blueprint applied with GROQ_API_KEY; health OK, AI available
- [x] Live check with the real resume in Chrome: 22/22 feature steps pass (import, preview, templates, exports,
      analysis, Improve + AI, versions, tailoring + AI, cover letter + AI, applications, backup, privacy)

## Possible next steps (not started)

- Grow the import corpus with real resumes (with permission) and add more templates
- Grammar/spelling without AI (a curated, tech-aware dictionary)
- A dedicated "career changer" rubric; more skills in the ontology for non-tech fields
