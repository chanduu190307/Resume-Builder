import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SHOTS = "e2e/.results/screens";

async function pdfText(path: string): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    text += (await (await pdf.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  }
  return text.replace(/\s+/g, " ");
}

async function createResume(page: Page) {
  await page.goto("/resumes");
  await page.getByRole("button", { name: /create a resume|new resume/i }).first().click();
  await expect(page).toHaveURL(/\/resumes\/[0-9a-f]{12}$/);
  await expect(page.getByRole("region", { name: "Contact details" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Every test starts with empty browser storage.
  await page.goto("/");
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("resume-builder");
    req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
  }));
});

test("build a resume, see the preview, autosave and export PDF + DOCX", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });
  await page.getByRole("link", { name: /create a resume/i }).click();
  await page.screenshot({ path: `${SHOTS}/02-library-empty.png`, fullPage: true });
  await page.getByRole("button", { name: /create a resume/i }).click();

  const contact = page.getByRole("region", { name: "Contact details" });
  await contact.getByLabel("Full name").fill("Priya Sharma");
  await contact.getByLabel("Professional title (optional)").fill("Frontend Developer");
  await contact.getByLabel("Email").fill("priya.sharma@example.com");
  await contact.getByLabel("Location").fill("Pune, India");

  const summary = page.getByRole("region", { name: "Summary" });
  await summary.getByLabel("Text").fill("Frontend developer with 3 years of experience building accessible React applications.");

  const experience = page.getByRole("region", { name: "Experience" });
  await experience.getByLabel("Job title").fill("Frontend Developer");
  await experience.getByLabel("Company / organisation").fill("Northwind Labs");
  await experience.getByLabel("Start year").fill("2022");
  await experience.getByLabel("I currently work here").check();

  // Enter in a bullet starts a new bullet.
  const firstBullet = experience.getByLabel("What you did and achieved 1");
  await firstBullet.fill("Built a design system used across 4 product teams.");
  await firstBullet.press("Enter");
  await expect(experience.getByLabel("What you did and achieved 2")).toBeFocused();

  // Pasting a list splits it into separate bullets and strips the markers.
  await page.evaluate(() => {
    const el = document.activeElement as HTMLTextAreaElement;
    const data = new DataTransfer();
    data.setData("text/plain", "• Cut bundle size by 30%.\n• Added end-to-end tests.");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(experience.getByLabel("What you did and achieved 2")).toHaveValue("Cut bundle size by 30%.");
  await expect(experience.getByLabel("What you did and achieved 3")).toHaveValue("Added end-to-end tests.");

  const skills = page.getByRole("region", { name: "Skills" });
  const skillInput = skills.getByLabel("Skills");
  await skillInput.fill("React, TypeScript, Playwright");
  await skillInput.press("Enter");
  await expect(skills.getByRole("button", { name: "Remove TypeScript" })).toBeVisible();

  // The live preview is the real PDF.
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByRole("img", { name: /Resume preview, page 1 of/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800); // let the debounced preview settle for the screenshot
  await page.screenshot({ path: `${SHOTS}/03-editor.png`, fullPage: false });

  // Autosave: everything survives a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: "Contact details" }).getByLabel("Full name")).toHaveValue("Priya Sharma");
  await expect(page.getByLabel("What you did and achieved 3")).toHaveValue("Added end-to-end tests.");

  // PDF export contains the content as real text.
  const [pdfDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(pdfDownload.suggestedFilename()).toBe("Priya_Sharma_Resume.pdf");
  const pdfPath = await pdfDownload.path();
  const text = await pdfText(pdfPath);
  for (const expected of [
    "Priya Sharma", "Frontend Developer", "priya.sharma@example.com", "Pune, India", "Northwind Labs",
    "2022 – Present", "Built a design system used across 4 product teams.", "Cut bundle size by 30%.",
    "Added end-to-end tests.", "React, TypeScript, Playwright",
  ]) {
    expect(text).toContain(expected);
  }

  // DOCX export.
  const [docxDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "DOCX" }).click()]);
  expect(docxDownload.suggestedFilename()).toBe("Priya_Sharma_Resume.docx");
  const zip = await JSZip.loadAsync(readFileSync(await docxDownload.path()));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Northwind Labs");
  expect(xml).toContain("Cut bundle size by 30%.");
});

test("undo / redo, hide and reorder sections, templates", async ({ page }) => {
  await createResume(page);
  const name = page.getByRole("region", { name: "Contact details" }).getByLabel("Full name");
  await name.fill("Test Person");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Control+z");
  await expect(name).toHaveValue("");
  await page.keyboard.press("Control+Shift+z");
  await expect(name).toHaveValue("Test Person");

  // Reorder: move Skills up above Education.
  const headings = () => page.getByLabel("Section heading").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(await headings()).toEqual(["Summary", "Experience", "Education", "Skills"]);
  await page.getByRole("region", { name: "Skills" }).getByRole("button", { name: "Move section up" }).click();
  expect(await headings()).toEqual(["Summary", "Experience", "Skills", "Education"]);

  // Hide a section.
  await page.getByRole("region", { name: "Education" }).getByRole("button", { name: "Hide section from resume" }).click();
  await expect(page.getByRole("region", { name: "Education" }).getByText("hidden from resume")).toBeVisible();

  // Add a section through the dialog.
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("button", { name: /Projects/ }).click();
  expect(await headings()).toContain("Projects");

  // Switch template and page size.
  await page.getByLabel("Template").selectOption("modern");
  await page.getByLabel("Page size").selectOption("Letter");
  await expect(page.getByRole("complementary", { name: "Preview" }).getByRole("img").first()).toBeVisible({ timeout: 20_000 });
});

test("library: rename, duplicate, delete, backup, restore and delete all data", async ({ page }) => {
  await createResume(page);
  await page.getByRole("region", { name: "Contact details" }).getByLabel("Full name").fill("Backup Person");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "Back to your resumes" }).click();

  const cards = page.getByRole("listitem");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Backup Person");

  // Rename.
  await page.getByRole("button", { name: "Resume actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Resume name").fill("Frontend roles");
  await page.getByLabel("Resume name").press("Enter");
  await expect(cards.first()).toContainText("Frontend roles");

  // Duplicate.
  await page.getByRole("button", { name: "Resume actions" }).first().click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Copy of Frontend roles")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-library.png`, fullPage: true });

  // Backup.
  await page.getByRole("button", { name: "Backup & data" }).click();
  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const backupPath = await backup.path();
  expect(JSON.parse(readFileSync(backupPath, "utf8")).resumes).toHaveLength(2);

  // Delete all data.
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("No resumes yet")).toBeVisible();

  // Restore from the backup.
  await page.getByRole("button", { name: "Backup & data" }).click();
  await page.locator('input[type="file"]').setInputFiles(backupPath);
  // The backup also carries the automatic restore points created while editing.
  await expect(page.getByText(/^Restored 2 resumes( and \d+ saved versions?)?\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(cards).toHaveCount(2);

  // Delete one.
  await page.getByRole("button", { name: "Resume actions" }).first().click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete resume" }).click();
  await expect(cards).toHaveCount(1);
});

test("mobile layout switches between editing and preview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createResume(page);
  await page.getByRole("region", { name: "Contact details" }).getByLabel("Full name").fill("Mobile Person");
  await page.screenshot({ path: `${SHOTS}/05-mobile-edit.png`, fullPage: false });
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("img", { name: /Resume preview, page 1/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Contact details" })).toBeHidden();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/06-mobile-preview.png`, fullPage: false });
});
