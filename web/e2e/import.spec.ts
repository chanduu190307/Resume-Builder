import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const RENDERED = fileURLToPath(new URL("../../fixtures/rendered/", import.meta.url));
const SHOTS = "e2e/.results/screens";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("resume-builder");
        req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
      }),
  );
});

test("import a PDF, review it, and continue to the editor", async ({ page }) => {
  await page.goto("/resumes");
  await page.getByRole("button", { name: /import an existing resume/i }).click();
  await expect(page.getByRole("heading", { name: "Import your resume" })).toBeVisible();

  await page.getByLabel("Resume file").setInputFiles(`${RENDERED}02_senior_software_engineer.classic.pdf`);
  await expect(page.getByRole("heading", { name: "Check your imported resume" })).toBeVisible({ timeout: 20_000 });

  const contact = page.getByRole("region", { name: "Contact details found" });
  await expect(contact).toContainText("Marcus Bennett");
  await expect(contact).toContainText("marcus.bennett@example.com");
  const experience = page.getByRole("region", { name: "Experience" });
  await expect(experience).toContainText("Senior Software Engineer · Contoso Payments");
  await expect(experience).toContainText("Mar 2021 – Present");
  await expect(page.getByText(/could not be placed/)).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Preview" }).getByRole("img").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/07-import-review.png`, fullPage: false });

  await page.getByRole("button", { name: "Continue to editor" }).click();
  await expect(page).toHaveURL(/\/resumes\/[0-9a-f]{12}$/);
  await expect(page.getByRole("region", { name: "Contact details" }).getByLabel("Full name")).toHaveValue("Marcus Bennett");
  await expect(page.getByLabel("Resume name")).toHaveValue("Marcus Bennett (imported)");
  await expect(page.getByLabel("Job title").first()).toHaveValue("Senior Software Engineer");
});

test("pasted text with an unplaceable line is kept and flagged", async ({ page }) => {
  await page.goto("/import");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page
    .getByLabel("Resume text")
    .fill("Jane Doe\njane@example.com\nA stray line ✦ that fits nowhere\nSKILLS\nPython, SQL");
  await page.getByRole("button", { name: "Import text" }).click();

  await expect(page.getByText("1 line could not be placed automatically")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("listitem").filter({ hasText: "A stray line ✦ that fits nowhere" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to editor" }).click();

  await expect(page.getByText(/1 line from your import could not be placed/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Imported text to review" })).toContainText("hidden from resume");
});

test("unsupported files get a clear message", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Resume file").setInputFiles({
    name: "old.doc",
    mimeType: "application/msword",
    buffer: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]),
  });
  await expect(page.getByRole("alert")).toContainText("Old Word .doc files are not supported");
});
