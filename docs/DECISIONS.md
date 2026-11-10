# Decisions

Short records of choices that shape the codebase. Add new entries at the bottom.

## D1 - Python engine + React web app
- **Engine**: Python (FastAPI, Pydantic). Best ecosystem for document parsing and NLP.
- **Web**: React + TypeScript (Vite), Tailwind CSS v4.
- The engine is **stateless**: no accounts, no database of resumes. Requests are processed and discarded.

## D2 - One canonical resume model, generated everywhere
The Pydantic model in `engine/src/resume_engine/schema/resume.py` is the single source of truth.
JSON Schema (`shared/schema/`) and TypeScript types (`web/src/types/resume.generated.ts`) are
generated from it. Tests on both sides fail if either is stale.

## D3 - The schema enforces structure, not quality
Content problems (end date before start date, malformed email, missing summary) are **reported by
analysis**, never rejected by the schema. Rejecting would make it possible to lose user data during
import. Structural problems (unknown fields, unknown section types, impossible months, duplicate ids,
a current role with an end date) are rejected.

## D4 - Text is never silently modified
The schema does not trim or normalise free text. Normalisation happens in an explicit, tested
step during import, and comparison normalises only for scoring.

## D5 - Provenance on rewritable text
Bullets and summaries carry `origin: "user" | "ai_assisted"`. `ai_assisted` is only set when the user
explicitly accepts a suggestion. Suggestions themselves live outside the resume until accepted.

## D6 - Sections are an ordered list of typed sections
`sections[]` order is display order. Internships and volunteering are `experience` sections with an
`employment_type`; anything unusual uses a `custom` section. Section titles are user-editable.

## D7 - IDs are generated when missing
Every item has an `id` so suggestions can target it. Fixtures omit ids; the engine fills them in.
The accuracy harness ignores ids.

## D8 - Data stays in the browser
No accounts. Resumes are stored in the browser (IndexedDB from Phase 1). The engine must never log
resume or job description content.

## D9 - LLM access is server-side only
The Claude API key lives only in the engine's environment, never in the web bundle. LLM output is
always validated against a schema and checked by deterministic code before reaching the user.

## D10 - PDFs are generated in the browser; the preview *is* the export
PDF generation uses react-pdf in the browser, so the builder works with the engine offline. The
live preview renders the very same PDF bytes with pdf.js, so preview and download cannot differ.
Text is real, selectable and in reading order; hyphenation is disabled because hyphenated words
break ATS keyword matching.

## D11 - One document model, templates are style settings
`buildDocument()` turns a resume into a format-neutral model; the PDF and DOCX renderers only draw
it. Templates (Classic, Modern, Compact) are style configurations of one renderer, all single
column. Content decisions (what is shown, date format "Jun 2025 – Present", labels) live in one
tested place.

## D12 - Embedded open fonts matched to Word fonts
PDFs embed Carlito / Caladea (SIL OFL, in `web/public/fonts`), which are metric-compatible with
Calibri / Cambria used by the DOCX export, so both have the same line breaks and full Unicode text.

## D13 - Workaround for a fontkit glyph-cache bug (found by our tests)
fontkit caches glyphs with the characters of the *first* request; its subsetter requests composite
components with no characters. A later PDF then wrote empty ToUnicode entries and "B.S." extracted
as "#s#". `preparePdfFonts()` patches each font so missing characters are filled in. Export tests
assert that no PDF contains an empty ToUnicode entry, and a regression test reproduces the
original sequence. Re-check when upgrading react-pdf, pdfkit or fontkit.

## D14 - Backups are the safety net for "no accounts"
Users can download all resumes as JSON and restore them. Restore validates against the engine's
JSON Schema, imports nothing if anything is invalid, and gives conflicting ids a new id instead of
overwriting.

## D15 - End-to-end tests use the installed Chrome
Playwright drives the system Chrome (`channel: "chrome"`), so no browser download is needed.
`npm run e2e` tests the dev server; `npm run e2e:prod` tests the production bundle.

## D16 - Import is deterministic first; AI only assists, and is verified
The rule-based parser always runs and is measured on the rendered corpus
(`python -m resume_engine.evals.import_report`). AI-assisted extraction runs only when a key is
configured and the rules left text unplaced (or the PDF is a scan). Every AI value must appear in
the document text or it is discarded and reported, so AI can organise a resume but never add to it.
The AI prompt treats the resume as data and ignores instructions inside it (prompt-injection guard).

## D17 - pdfplumber, not PyMuPDF
PDF extraction uses pdfplumber (MIT). PyMuPDF is AGPL, which is unsuitable for a product.

## D18 - Claude API usage
Model `claude-opus-5-5` by default (`RESUME_ENGINE_MODEL` overrides), structured output via
`output_config.format` (JSON schema), and server-side `fallbacks: "default"`
(`server-side-fallback-2026-07-01` beta) so a safety decline is retried on another model. Prompts and
responses are never logged. The engine depends on a small `StructuredLLM` protocol so tests use a fake.

## D19 - Import found three export bugs; all fixed with tests
(1) DOCX used a literal tab character instead of a Word tab, so dates might not right-align in Word.
(2) A long PDF contact line wrapped inside a URL and react-pdf inserted a stray "-". (3) Page-furniture
removal deleted real content that happened to repeat at page edges. Each now has a regression test.

## D20 - Scores are rules, not AI
Quality and Parsing Readiness are computed by deterministic rules with injectable "today", so the
same resume always gets the same score and every point has a stated reason. AI is never asked to
produce a score. Parsing Readiness is honest about its limits: it measures how reliably a typical
parser (ours) reads the exported PDF; it does not claim to replicate any vendor's ATS.

## D21 - Analysis types are generated too
`AnalysisResult` (Pydantic) is exported to `shared/schema/analysis.schema.json` and compiled to
`web/src/types/analysis.generated.ts`; drift checks cover both schemas.

## D22 - Tailoring works on a copy, and suggestions are operations
Starting a tailoring session duplicates the resume and stores a snapshot of the original in the job
record, so the original is never modified and the comparison view always has a baseline. The engine
returns suggestions as explicit edit operations with the text they were based on; the web applies an
operation only if that text is unchanged, otherwise it reports the suggestion as out of date.

## D23 - Matching with meaning, explainably
Instead of embeddings, matching uses a curated ontology (aliases + "implies" relations) and stem
matching for multi-word skills. Every keyword status and requirement check cites the resume text that
justifies it. Implied skills are never added without the user confirming they have used them.

## D24 - Link import and SSRF
Only http/https on ports 80/443; every resolved address and every redirect must be public; 2 MB and 10 s
caps. Residual risk: a DNS answer could change between the check and the request (rebinding). This is
acceptable for a local single-user engine; a hosted deployment should pin the resolved IP or use an
egress proxy.

## D25 - Versions and applications live in the browser too
IndexedDB v3 adds `jobs` (tailoring sessions / applications) and `versions` stores alongside `resumes`.
Backups (v2) contain all three. Restores never overwrite: conflicting ids get new ids and every job and
version that pointed at a renamed resume is re-linked.

## D26 - Cover letters are assembled, not written
The draft is built from the user's own sentences (bullets converted mechanically to first person) and the
job's title and company, joined by fixed phrases, so it cannot claim anything the resume does not. AI may
only polish it, and the result must pass the truthfulness guard (with the job's company and title allowed).

## D27 - Accessibility is tested, not assumed
An axe audit (WCAG 2.1 A/AA) of every page and panel runs in the e2e suite and fails on serious or critical
violations. Design tokens were adjusted so all text meets 4.5:1 contrast on every surface.

## D28 - Phase 7 redesign: motion only where it explains something
The visual direction ("Kinetic Solitude": warm canvas, faint indigo/violet/sky glows, frosted glass chrome,
indigo accent) was designed in Google Stitch (`docs/redesign/stitch-home.png`). Stitch's sample copy was
not used where it claimed things the app does not do (e.g. "encryption", "Terms" pages).
- All motion goes through `src/lib/motion/motion.ts` (pointer depth, reveal-on-view, count-up) and a few
  CSS classes in `index.css`. No animation library: CSS transitions plus React 19's `<ViewTransition>` for
  page changes (React Router already wraps navigations in `startTransition`).
- Where: home hero (3D page stack tilting toward the cursor, parallax chips), score rings and bars that fill
  on view, the live preview as a slight 3D stack that lies flat on hover/focus, sliding tab pills, suggestion
  cards that slide out on accept/reject, page transitions. Not in forms: nothing moves while you type.
- `prefers-reduced-motion` turns every effect off; pointer effects are off on touch devices; content is
  never hidden when JavaScript or IntersectionObserver is missing. Animated numbers are decorative; the real
  value is in visually hidden text and in `data-score` (which tests read).
- Background glows are radial gradients, not `blur()` filters, so drifting them is cheap on machines
  without a GPU. PDF/DOCX templates are unchanged (ATS rules, D10-D12).

## D29 - AI provider: Groq by default, chosen explicitly, never a silent fallback
At the user's request the project uses its own Groq key instead of the Claude key on this machine.
- `RESUME_ENGINE_LLM_PROVIDER` selects `groq` (default) or `anthropic`. Each provider only uses its own key
  (`GROQ_API_KEY` / `ANTHROPIC_API_KEY`); a key for the other provider is ignored, so a machine-wide
  `ANTHROPIC_API_KEY` is never used unless `anthropic` is chosen. The key lives in `engine/.env`
  (git-ignored), which `scripts/dev.ps1` loads.
- `GroqLLM` calls Groq's OpenAI-compatible chat completions over `httpx` (no new dependency) with
  `response_format: json_schema` and `strict: true`. All five AI schemas meet Groq's strict-mode rules
  (every property required, `additionalProperties: false`), enforced by a test.
- Default model `openai/gpt-oss-120b` (one of the models Groq lists for strict mode). Text only: scanned
  PDFs cannot be read by AI with Groq and the import says so (D16's verification is unchanged).
- Everything after the model is unchanged: import values are verified against the document, rewording and
  cover-letter polish pass the truthfulness guard, scores never use AI (D20).
- Groq's free tier allows about 8,000 tokens per minute for this model; one AI import uses ~7,000. A 429 is
  shown as "usage limit reached, try again in N seconds". Error logs contain Groq's error code only, never
  the body (it can echo generated resume text).
- D18 still describes the Anthropic provider when it is selected.

## D30 - Groq only, with a free-model fallback chain (supersedes the Anthropic part of D18/D29)
At the user's request the Anthropic code path and the `anthropic` dependency were removed: no Anthropic key
can be used by this project. `GROQ_API_KEY` is the only AI credential.
- Free tier: each Groq model has its own budget (about 8,000 tokens per minute), and one AI import uses about
  7,000. A request therefore walks a chain of free models (default `openai/gpt-oss-120b`, then
  `openai/gpt-oss-20b`, then `qwen/qwen3.8-27b`; configurable) when a model is rate limited (429), overloaded
  (5xx), times out, is missing (404) or answers badly. The same model is never retried, because a retry would
  usually hit that model's per-minute limit.
- The first model uses strict JSON-schema output. Live tests showed the two smaller models break on our
  larger schemas in strict mode (e.g. output `{person}`), but answer correctly in JSON mode with the schema in
  the instructions, so fallback models use JSON mode and their answers are checked by `llm/validate.py`
  (a small validator for exactly the keywords our schemas use; unknown keywords are an error).
- Nothing else changes: import values are verified against the document, rewording passes the truthfulness
  guard, scores never use AI (D20). Error logs carry Groq's error code only.

## D31 - Real-world import fixes (found with a real student resume)
A real Indian-format student resume exposed parser gaps that our generated corpus never had. Fixed, with
fictional regression tests (`tests/test_parser_realworld.py`); corpus accuracy unchanged at 99.8%:
- An unknown ALL-CAPS line is a heading only if its font size/weight match this document's known headings
  and it is not the first line (an ALL-CAPS name or project title is not a section).
- A bullet glyph laid out as its own word (Symbol-font "") still marks a bullet.
- Education: a new dated line starts the next school; "CGPA: 6.8" / "Percentage: 79.5" beside the degree is
  the grade. Projects: "2. TITLE" at the left margin is a title, "Description:" labels are skipped, trailing
  colons are removed. Dateless "Title / Issuer" certifications split on each bold title.
- Tailoring: a skill that already says the job's wording ("Data Structures & Algorithms") is never rewritten,
  and no replacement may repeat words (it produced "data structures and algorithms & Algorithms").
- Not done (needs a model change): certification descriptions have no field and go to "Imported text to
  review" (nothing is lost).

## D32 - Hosting: one Render web service (engine serves the app)
The user dropped Netlify. `render.yaml` defines a single free Python web service: the build runs
`npm ci && npm run build` (Node is available in Render's native runtimes) and `pip install ./engine`; the
engine then serves `web/dist` when `RESUME_ENGINE_WEB_DIST` is set (`api/web.py`, a catch-all GET route
added after all API routes). Same origin means no CORS and no `VITE_API_BASE`; unknown `/api/...` paths
stay 404s; client-side routes get `index.html`; hashed assets are cached for a year; `.mjs` is served as
JavaScript (the pdf.js worker). `GROQ_API_KEY` is a `sync: false` secret entered in Render, never committed.
Because Windows Smart App Control blocks the engine on the developer PC, GitHub Actions runs the test suites
and the exact Render build/start with HTTP smoke checks on Linux.

## D33 - Certification descriptions; custom sections keep "Label : value" lines whole
Found on the live site with a real resume (9 lines left in "Imported text to review").
- `CertificationItem.description` (optional, like awards and publications). The parser puts a certification's
  plain body lines there (wrapped lines joined); a body line that is only a link is still the URL. The AI
  import maps `description` too, and like every AI value it is kept only if it appears in the document.
- Custom sections (Personal Details, Declaration...): header lines of the form "Label : value" (value may be
  empty) become one bullet each, verbatim. Before, "D.O.B : 28-04-2006" lost "2006" to a date field and a
  right-aligned "Signature" was taken as a location, leaving parts of both lines unplaced.
- The JSON Schema was edited to match the generator byte-for-byte (the generator could not run on the Windows
  PC, which blocks pydantic); the drift checks in CI confirm it.
