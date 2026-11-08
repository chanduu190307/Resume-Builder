// Builds docs/Resume-Builder-Guide.pdf: a visual walkthrough of every feature,
// captured from the running app (default http://localhost:5173; start it with scripts/dev.ps1).
//
//   node scripts/make-guide.mjs [baseUrl]
//
// Uses a fresh browser profile, so your own resumes are never touched.
// If the engine has an AI key configured, the AI steps make a few small API calls.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:5173";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = `${ROOT}docs/guide-screens/`;
const OUT = `${ROOT}docs/Resume-Builder-Guide.pdf`;
mkdirSync(SHOTS, { recursive: true });

const shots = {};
let n = 0;
async function shot(target, name, opts = {}) {
  const file = `${SHOTS}${String(++n).padStart(2, "0")}-${name}.png`;
  await target.screenshot({ path: file, ...opts });
  shots[name] = file;
  console.log("captured", name);
}
const settle = (page, ms = 700) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(ms));

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, acceptDownloads: true });
const page = await context.newPage();

const health = await (await page.request.get(`${BASE}/api/health`)).json();
const ai = Boolean(health.ai_available);
console.log("AI available:", ai);

// ---------------------------------------------------------------- start
await page.goto(BASE);
await settle(page);
await shot(page, "home");
await page.goto(`${BASE}/resumes`);
await settle(page);
await shot(page, "library-empty");

// ---------------------------------------------------------------- create from scratch
await page.getByRole("button", { name: "Create a resume" }).click();
await page.getByRole("region", { name: "Contact details" }).getByLabel("Full name").fill("Priya Sharma");
await page.getByRole("region", { name: "Contact details" }).getByLabel("Professional title (optional)").fill("Frontend Developer");
await page.getByRole("region", { name: "Contact details" }).getByLabel("Email").fill("priya.sharma@example.com");
const exp = page.getByRole("region", { name: "Experience" });
await exp.getByLabel("Job title").fill("Frontend Developer");
await exp.getByLabel("Company / organisation").fill("Northwind Labs");
await exp.getByLabel("Start year").fill("2022");
await exp.getByLabel("I currently work here").check();
await exp.getByLabel("What you did and achieved 1").fill("Built a design system used across 4 product teams.");
await settle(page, 1500);
await shot(page, "editor-new");
await page.getByRole("button", { name: "Add section" }).click();
await settle(page, 300);
await shot(page, "add-section");
await page.keyboard.press("Escape");

// ---------------------------------------------------------------- import
await page.goto(`${BASE}/import`);
await settle(page);
await shot(page, "import");
await page.getByLabel("Resume file").setInputFiles(`${ROOT}fixtures/rendered/02_senior_software_engineer.classic.pdf`);
await page.getByRole("heading", { name: "Check your imported resume" }).waitFor({ timeout: 30_000 });
await settle(page, 1500);
await shot(page, "import-review");
await page.getByRole("button", { name: "Continue to editor" }).click();
await page.getByLabel("Resume name").waitFor();
await settle(page, 1800);
await shot(page, "editor-imported");
await shot(page.getByRole("complementary", { name: "Preview" }).getByRole("img").first(), "preview-classic");
await page.getByLabel("Template").selectOption("modern");
await settle(page, 1800);
await shot(page.getByRole("complementary", { name: "Preview" }).getByRole("img").first(), "preview-modern");
await page.getByLabel("Template").selectOption("classic");

// ---------------------------------------------------------------- analysis
await page.getByRole("tab", { name: "Analysis" }).first().click();
await page.getByRole("region", { name: "Resume Quality score" }).waitFor({ timeout: 30_000 });
await settle(page, 1000);
await shot(page, "analysis");
await page.getByRole("button", { name: "Resume Quality breakdown" }).click();
await settle(page, 300);
await shot(page.getByRole("complementary", { name: "Analysis" }), "analysis-breakdown");
await page.getByText("What an ATS sees").click();
await settle(page, 300);
await page.getByText("What an ATS sees").scrollIntoViewIfNeeded();
await shot(page, "ats-text");

// ---------------------------------------------------------------- improve
await page.getByRole("tab", { name: "Improve" }).first().click();
await page.getByText("Improvements that keep your facts exactly as they are.").waitFor();
await settle(page, 1200);
if (ai) {
  await page.getByRole("button", { name: "Improve wording with AI" }).click();
  await page.getByRole("button", { name: "Improve wording with AI" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("button[disabled] .animate-spin"), null, { timeout: 180_000 });
  await settle(page, 800);
}
await shot(page, "improve");

// ---------------------------------------------------------------- history
await page.getByRole("region", { name: "Contact details" }).getByLabel("Professional title (optional)").fill("Senior Backend Engineer");
await page.getByRole("button", { name: "Version history" }).click();
await page.getByLabel("Version name").fill("Before tailoring");
await page.getByRole("button", { name: "Save version" }).click();
await settle(page, 400);
await shot(page, "history");
await page.getByRole("button", { name: "Close" }).click();

// ---------------------------------------------------------------- tailor
await page.getByRole("link", { name: "Tailor to a job" }).click();
await page.getByLabel("Job description", { exact: true }).fill(readFileSync(`${ROOT}fixtures/jobs/backend_engineer.txt`, "utf8"));
await settle(page, 300);
await shot(page, "tailor-start");
await page.getByRole("button", { name: "Compare and tailor" }).click();
await page.getByRole("region", { name: "Job Match score" }).waitFor({ timeout: 30_000 });
await settle(page, 1500);
await shot(page, "tailor");
await page.getByRole("button", { name: "Job Match breakdown" }).click();
await settle(page, 300);
await shot(page.getByRole("button", { name: "Job Match breakdown" }).locator("xpath=.."), "match-breakdown");
const keywords = page.getByRole("region", { name: "Keywords" });
await keywords.getByRole("button", { name: /Golang/ }).click();
await settle(page, 300);
await shot(keywords, "keywords");
await shot(page.getByRole("region", { name: "Requirements" }), "requirements");
await shot(page.getByRole("listitem", { name: /if you have used it/ }).first(), "confirm-suggestion");
await shot(page.getByRole("listitem", { name: "Add a real number to this point" }).first(), "metric-prompt");
if (ai) {
  await page.getByRole("button", { name: "Suggest rewording with AI" }).click();
  await page.waitForFunction(() => !document.querySelector("button[disabled] .animate-spin"), null, { timeout: 180_000 });
  await settle(page, 800);
  const rewrite = page.getByRole("listitem", { name: /Reword this point|Tailor your summary/ }).first();
  if (await rewrite.count()) await shot(rewrite, "ai-rewrite");
}
await page.getByRole("listitem", { name: "Write “Kafka” as “Apache Kafka”" }).getByRole("button", { name: "Accept" }).click();
await page.getByRole("listitem", { name: "Write “Go” as “Golang”" }).getByRole("button", { name: "Accept" }).click();
await page.getByRole("tab", { name: "Changes" }).click();
await settle(page, 800);
await shot(page.getByRole("region", { name: "Changes" }), "changes");
await page.getByRole("tab", { name: "Cover letter" }).click();
await page.getByRole("button", { name: "Draft from my resume" }).click();
await page.getByLabel("Cover letter text").waitFor();
if (ai) {
  await page.getByRole("button", { name: "Polish with AI" }).click();
  await page.waitForFunction(() => !document.querySelector("button[disabled] .animate-spin"), null, { timeout: 180_000 });
}
await settle(page, 600);
await shot(page.getByRole("region", { name: "Cover letter" }), "cover-letter");

// ---------------------------------------------------------------- applications, data, privacy
await page.goto(`${BASE}/jobs`);
await settle(page);
const card = page.getByRole("listitem", { name: /Senior Backend Engineer/ });
await card.getByLabel("Application status").selectOption("applied");
await card.getByText("Notes").click();
await card.getByLabel("Notes").fill("Applied through the careers page. Follow up in one week.");
await card.getByLabel("Notes").blur();
await settle(page, 500);
await shot(page, "applications");
await page.goto(`${BASE}/resumes`);
await settle(page);
await shot(page, "library");
await page.getByRole("button", { name: "Backup & data" }).click();
await settle(page, 300);
await shot(page, "backup");
await page.getByRole("button", { name: "Close" }).click();
await page.goto(`${BASE}/privacy`);
await settle(page);
await shot(page, "privacy");

// ---------------------------------------------------------------- other screen sizes
const resumeLink = page.getByRole("link", { name: "Marcus Bennett (imported)", exact: true });
await page.goto(`${BASE}/resumes`);
await resumeLink.click();
const editorUrl = page.url();
for (const [name, w, h] of [["tablet", 820, 1180], ["phone", 390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(editorUrl);
  await settle(page, 1200);
  await shot(page, `${name}-editor`);
  await page.getByRole("tab", { name: "Preview" }).first().click();
  await settle(page, 1800);
  await shot(page, `${name}-preview`);
  await page.goto(`${BASE}/jobs`);
  await settle(page);
  await shot(page, `${name}-applications`);
}
await page.setViewportSize({ width: 1440, height: 900 });

// ---------------------------------------------------------------- assemble the PDF
const img = (name, cls = "") => (shots[name] ? `<img class="${cls}" src="data:image/png;base64,${readFileSync(shots[name]).toString("base64")}" />` : "");
const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const sections = [
  ["How to run it", `
    <p>The app has two parts that run on your computer: the <b>engine</b> (Python; reads, scores and tailors resumes) and the <b>web app</b> (what you see in the browser).</p>
    <ol><li>Open PowerShell in <code>D:\\Resume Builder</code>.</li><li>Run <code>.\\scripts\\dev.ps1</code>.</li><li>Open <b>http://localhost:5173</b> in your browser.</li></ol>
    <p>The green <b>Engine online</b> dot in the top-right corner shows the engine is running. Building, editing and exporting resumes also work without the engine; importing, analysis and tailoring need it.</p>
    <p><b>AI features are optional.</b> They switch on when an AI key is configured in <code>engine\\.env</code> (this project uses Groq: <code>GROQ_API_KEY</code>). Everything else works without AI.</p>`],
  ["1. Home", `<p>Two starting points: <b>Create a resume</b> (the builder) and <b>Tailor to a job</b>. The header links to your <b>Resumes</b> and <b>Applications</b> on every page.</p>${img("home")}`],
  ["2. Your resumes", `<p>All resumes are saved automatically <b>in this browser</b>: no account, no server storage. From here you can create, import, tailor, rename, duplicate or delete resumes.</p>${img("library-empty")}<p>With resumes saved, each card shows its template and when it was last edited:</p>${img("library")}`],
  ["3. Building a resume", `<p>The editor has your sections on the left and a <b>live preview</b> on the right. The preview is the exact PDF you will download, so page breaks are exactly as shown. Each section has a short writing tip; nothing is ever written for you.</p>${img("editor-new")}
    <ul><li><b>Bullets:</b> Enter starts the next bullet; Backspace on an empty bullet removes it; pasting a list splits it into bullets.</li><li><b>Sections:</b> rename, hide, reorder or delete; <b>Undo / Redo</b> with Ctrl+Z / Ctrl+Shift+Z.</li><li><b>Templates:</b> Classic, Modern and Compact, in A4 or Letter. All are single-column and ATS-friendly.</li><li><b>Export:</b> PDF and Word (DOCX) with real, machine-readable text.</li></ul>
    ${img("add-section")}`],
  ["4. Templates", `<p>The same resume in the Classic and Modern templates. Templates change only the styling: the content is identical and always readable by applicant tracking systems.</p><div class="pair">${img("preview-classic")}${img("preview-modern")}</div>`],
  ["5. Importing an existing resume", `<p>Upload a <b>PDF, Word or text</b> file (up to 5 MB) or paste the text. The engine reads it, keeps your wording exactly, and organises it into sections. Nothing is saved until you confirm.</p>${img("import")}
    <p>The review screen shows what was found, highlights anything missing (e.g. a role without a company), lists any lines that could not be placed (they are kept in a hidden section, never dropped), and shows the text exactly as a parser read it.</p>${img("import-review")}
    <p>Measured accuracy on our test set: <b>99.8%</b> of fields across 54 files (100% for PDF, Word and two-column layouts).</p>`],
  ["6. The imported resume in the editor", `<p>After import the resume is fully editable, with the preview alongside.</p>${img("editor-imported")}`],
  ["7. Analysis: two independent scores", `<p>The <b>Analysis</b> tab gives two separate scores, both calculated by fixed rules so the same resume always gets the same score:</p>
    <ul><li><b>Resume Quality</b>: completeness, impact (measurable results, action verbs), clarity, consistency, skills and length. Targets adapt to early-career or experienced candidates.</li><li><b>Parsing Readiness</b>: how reliably an applicant tracking system can read it. The exported PDF is actually read back and compared field by field.</li></ul>${img("analysis")}
    <p>Every criterion shows its points, what was counted and how to improve. <b>Show me / Go to</b> jumps to the exact field.</p>${img("analysis-breakdown", "narrow")}`],
  ["8. What an ATS sees", `<p>The plain text read back from your exported PDF, in the order a parser reads it. If something is missing or garbled here, it is missing for the ATS too.</p>${img("ats-text")}`],
  ["9. Improve (no job description needed)", `<p>The <b>Improve</b> tab suggests improvements that keep your facts exactly as they are:</p>
    <ul><li><b>Safe fixes</b> that only remove or re-inflect existing words: drop "I", past tense for roles you have left, remove duplicate bullets and repeated skills.</li><li><b>Prompts</b>: "Add a real number to this point". You type the real figure; numbers are never invented.</li><li><b>AI wording</b> (optional) for clarity, grammar and spelling. Every AI suggestion is checked against your resume; anything that adds a number, skill, employer or years of experience is discarded and shown to you with the reason.</li></ul>${img("improve")}`],
  ["10. Version history", `<p>A restore point is saved automatically before each editing session and before every restore. Name a version to keep it permanently. Restoring never loses work.</p>${img("history")}`],
  ["11. Tailor to a job", `<p>Choose a resume and paste the job description (or import it from a link). Tailoring always works on a <b>copy</b>; your original resume stays unchanged.</p>${img("tailor-start")}
    <p>The workspace shows the <b>Job Match</b> score, separate from resume quality, with suggestions on the left and the tailored resume on the right.</p>${img("tailor")}${img("match-breakdown", "narrow")}`],
  ["12. Keywords and requirements", `<p>Every keyword from the job is sorted into five groups, matched by meaning (e.g. "Golang" = "Go"), with the resume text that justifies it: <b>already shown</b>, <b>shown in other words</b>, <b>weakly shown</b> (listed but not used in any role), <b>possibly supported</b> (implied by a related skill), and <b>not in your resume</b>.</p>${img("keywords", "narrow")}
    <p>Each requirement is checked separately: required, preferred and responsibilities, including years of experience and education.</p>${img("requirements", "narrow")}`],
  ["13. Truthful suggestions", `<p>Suggestions only change the wording or order of things you already wrote, or add a skill your own bullets already show. Anything implied must be <b>confirmed by you</b> first:</p>${img("confirm-suggestion", "narrow")}
    <p>Missing results become questions for you, never invented numbers:</p>${img("metric-prompt", "narrow")}
    ${shots["ai-rewrite"] ? `<p>Optional AI rewording for the job (checked by the truthfulness guard before you see it):</p>${img("ai-rewrite", "narrow")}` : ""}
    <p>Required skills you do not have are reported honestly as <b>gaps</b>, never added.</p>`],
  ["14. Comparing original and tailored", `<p>The <b>Changes</b> tab lists every difference from your original resume, word by word, with <b>Revert</b> on each change and <b>Restore original</b> for all.</p>${img("changes", "narrow")}`],
  ["15. Cover letter", `<p>A draft assembled only from your resume (your summary and your most relevant bullets, turned into first-person sentences) and the job's title and company, so it makes no claims you have not made. It can be polished with AI (guard-checked), edited, copied or downloaded, and is saved with the application.</p>${img("cover-letter", "narrow")}`],
  ["16. Applications tracker", `<p>Every job you tailored for appears here with its own resume version, status (Saved, Applied, Interviewing, Offer, Not selected, Withdrawn), the date you applied, the last Job Match score and your notes.</p>${img("applications")}`],
  ["17. Backup, privacy and your data", `<p>With no accounts, your data lives only in this browser. <b>Download backup</b> saves everything (resumes, applications, versions) to a file you can restore on any computer. <b>Delete all data</b> removes everything.</p>${img("backup")}${img("privacy")}`],
  ["18. Tablet and phone", `<p>The whole app adapts to the screen. On tablets and phones the editor switches between <b>Edit</b>, <b>Preview</b>, <b>Analysis</b> and <b>Improve</b> tabs, and the header becomes compact. It is checked automatically at six sizes (360 px phones to 1920 px desktops) for overlapping or off-screen elements, and audited for accessibility (WCAG 2.1 AA).</p>
    <div class="pair">${img("tablet-editor")}${img("tablet-preview")}</div><div class="trio">${img("phone-editor")}${img("phone-preview")}${img("phone-applications")}</div>`],
  ["19. The core rule: never invent qualifications", `
    <p>The app improves how your real experience is presented. It never adds skills, employers, job titles, dates, degrees, certifications, metrics or years of experience on its own.</p>
    <ul><li>Missing information is reported as a gap or asked of you.</li><li>Implied skills need your confirmation.</li><li>AI output is checked by code before you see it; proposals that add facts are discarded and shown with the reason.</li><li>Wording you accept from AI is marked, so you can always tell it apart from your own.</li><li>Scores are calculated by fixed rules, never by AI, and every point is explained.</li></ul>`],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  body { font-family: "Segoe UI", Inter, system-ui, sans-serif; color: #1c1d1f; font-size: 10.5pt; line-height: 1.5; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover .mark { width: 54px; height: 54px; border-radius: 14px; background: #1c1d1f; color: #fff; display: grid; place-items: center; font-size: 26px; font-weight: 700; }
  .cover h1 { font-size: 34pt; letter-spacing: -0.02em; margin: 28px 0 8px; }
  .cover p { font-size: 13pt; color: #5f6166; max-width: 150mm; }
  .cover .meta { margin-top: 40px; font-size: 10pt; color: #6b6d72; }
  .toc { page-break-after: always; }
  .toc h2 { font-size: 18pt; }
  .toc ol { columns: 1; padding-left: 18px; color: #3e5bd8; }
  .toc li { margin: 3px 0; } .toc li span { color: #1c1d1f; }
  section { page-break-before: always; }
  section:first-of-type { page-break-before: auto; }
  h2 { font-size: 17pt; letter-spacing: -0.01em; margin: 0 0 8px; }
  p, li { color: #2c2e31; } ul, ol { padding-left: 20px; }
  code { background: #f1f1ef; padding: 1px 5px; border-radius: 4px; font-size: 9.5pt; }
  img { display: block; width: 100%; border: 1px solid #e6e5e2; border-radius: 8px; margin: 10px 0 14px; box-shadow: 0 2px 8px rgba(16,17,19,.06); page-break-inside: avoid; }
  img.narrow { width: 72%; margin-left: auto; margin-right: auto; }
  .pair { display: flex; gap: 10px; } .pair img { width: 50%; }
  .trio { display: flex; gap: 10px; } .trio img { width: 33%; }
</style></head><body>
  <div class="cover"><div class="mark">R</div><h1>Resume Builder</h1>
    <p>A visual guide to every feature: building, importing, analysing, improving and tailoring your resume, truthfully.</p>
    <p class="meta">Screens captured from the running app on ${today}. AI features: ${ai ? "on (Groq API)" : "off (no API key configured)"}.</p></div>
  <div class="toc"><h2>Contents</h2><ol>${sections.map(([t]) => `<li><span>${t.replace(/^\d+\.\s*/, "")}</span></li>`).join("")}</ol></div>
  ${sections.map(([title, body]) => `<section><h2>${title}</h2>${body}</section>`).join("")}
</body></html>`;

writeFileSync(`${SHOTS}guide.html`, html);
const pdfPage = await context.newPage();
await pdfPage.setContent(html, { waitUntil: "load" });
await pdfPage.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:8px;color:#8d8f94;padding:0 14mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif"><span>Resume Builder — user guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log("wrote", OUT);
