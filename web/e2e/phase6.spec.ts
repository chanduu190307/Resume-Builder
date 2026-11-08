import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const JOB = readFileSync(`${ROOT}fixtures/jobs/backend_engineer.txt`, "utf8");

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

async function importSenior(page: Page) {
  await page.goto("/import");
  await page.getByLabel("Resume file").setInputFiles(`${ROOT}fixtures/rendered/02_senior_software_engineer.classic.pdf`);
  await page.getByRole("button", { name: "Continue to editor" }).click({ timeout: 20_000 });
  await expect(page.getByLabel("Resume name")).toHaveValue("Marcus Bennett (imported)");
}

test("version history: automatic restore points, named versions and safe restore", async ({ page }) => {
  await importSenior(page);
  const headline = page.getByRole("region", { name: "Contact details" }).getByLabel("Professional title (optional)");
  await headline.fill("Staff Engineer"); // first edit of the session creates a restore point

  await page.getByRole("button", { name: "Version history" }).click();
  const list = page.getByRole("list", { name: "Saved versions" });
  await expect(list).toContainText("Before editing on");
  await page.getByLabel("Version name").fill("Staff title");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(list).toContainText("Staff title");
  await page.getByRole("button", { name: "Close" }).click();

  await headline.fill("Principal Engineer");
  await page.getByRole("button", { name: "Version history" }).click();
  await list.getByRole("listitem").filter({ hasText: "Staff title" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Restored “Staff title”" })).toBeVisible();
  await expect(list).toContainText("Before restoring an earlier version");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(headline).toHaveValue("Staff Engineer");
});

test("applications, cover letter and full backup round trip", async ({ page }) => {
  await importSenior(page);
  await page.getByRole("link", { name: "Tailor to a job" }).click();
  await page.getByLabel("Job description", { exact: true }).fill(JOB);
  await page.getByRole("button", { name: "Compare and tailor" }).click();
  await expect(page.getByRole("region", { name: "Job Match score" })).toBeVisible({ timeout: 20_000 });

  // Cover letter: assembled from the resume, saved with the job.
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await page.getByRole("button", { name: "Draft from my resume" }).click();
  const letter = page.getByLabel("Cover letter text");
  await expect(letter).toHaveValue(/^Dear Northbridge Finance hiring team,/);
  await expect(letter).toHaveValue(/At Contoso Payments, I led a team of 5 engineers/);
  await page.reload();
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await expect(page.getByLabel("Cover letter text")).toHaveValue(/Dear Northbridge Finance hiring team,/);

  // Application tracker.
  await page.getByRole("link", { name: "Applications" }).click();
  const card = page.getByRole("listitem", { name: "Senior Backend Engineer, Payments at Northbridge Finance" });
  await expect(card).toContainText("Job Match");
  await card.getByLabel("Application status").selectOption("applied");
  await expect(card).toContainText("Applied");
  await card.getByText("Notes").click();
  await card.getByLabel("Notes").fill("Recruiter: Dana. Follow up next week.");
  await card.getByLabel("Notes").blur();

  // Backup includes applications; restore brings them back after deleting everything.
  await page.getByRole("link", { name: "Resumes", exact: true }).click();
  await page.getByRole("button", { name: "Backup & data" }).click();
  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const path = await backup.path();
  const data = JSON.parse(readFileSync(path, "utf8"));
  expect(data.version).toBe(2);
  expect(data.jobs).toHaveLength(1);
  expect(data.jobs[0].notes).toBe("Recruiter: Dana. Follow up next week.");
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.getByRole("button", { name: "Backup & data" }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByText(/Restored 2 resumes and 1 application/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "Applications" }).click();
  await expect(page.getByRole("listitem", { name: /Senior Backend Engineer/ })).toContainText("Applied");
});
