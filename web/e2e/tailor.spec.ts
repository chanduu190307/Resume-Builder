import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = "e2e/.results/screens";
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

test("tailor a resume to a job, truthfully, without touching the original", async ({ page }) => {
  // A resume to start from (imported from the senior engineer fixture PDF).
  await page.goto("/import");
  await page.getByLabel("Resume file").setInputFiles(`${ROOT}fixtures/rendered/02_senior_software_engineer.classic.pdf`);
  await page.getByRole("button", { name: "Continue to editor" }).click({ timeout: 20_000 });
  await expect(page.getByLabel("Resume name")).toHaveValue("Marcus Bennett (imported)");

  // Start tailoring from the editor.
  await page.getByRole("link", { name: "Tailor to a job" }).click();
  await expect(page.getByRole("heading", { name: "Tailor your resume to a job" })).toBeVisible();
  await page.getByLabel("Job description", { exact: true }).fill(JOB);
  await page.getByRole("button", { name: "Compare and tailor" }).click();

  await expect(page.getByRole("heading", { name: /Senior Backend Engineer, Payments/ })).toBeVisible({ timeout: 20_000 });
  const score = page.getByRole("region", { name: "Job Match score" });
  await expect(score).toContainText("/ 100", { timeout: 20_000 });

  // Keywords by category, with explanations.
  const keywords = page.getByRole("region", { name: "Keywords" });
  await expect(keywords).toContainText("Shown, in other words");
  await keywords.getByRole("button", { name: /Golang/ }).click();
  await expect(keywords).toContainText("You write it as “Go”; the job says “Golang”. Same skill.");
  await expect(page.getByRole("region", { name: "Requirements" })).toContainText("Strong proficiency in Golang or Java.");

  // Accept a wording suggestion.
  const kafka = page.getByRole("listitem", { name: "Write “Kafka” as “Apache Kafka”" });
  await kafka.getByRole("button", { name: "Accept" }).click();
  await expect(kafka).toHaveCount(0);

  // Implied skills need explicit confirmation.
  const confirm = page.getByRole("listitem", { name: /if you have used it/ }).first();
  const accept = confirm.getByRole("button", { name: "Accept" });
  await expect(accept).toBeDisabled();
  await confirm.getByRole("checkbox").check();
  await expect(accept).toBeEnabled();

  // AI rewording is clearly off without a key; everything else still works.
  await expect(page.getByRole("button", { name: "Suggest rewording with AI" })).toBeDisabled();

  // Changes view shows what changed, against the original.
  await page.getByRole("tab", { name: "Changes" }).click();
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(changes).toContainText("Apache Kafka");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/09-tailor.png`, fullPage: false });

  // The tailored copy has the change; the original resume does not.
  await page.getByRole("button", { name: "Open tailored resume" }).click();
  await expect(page.getByLabel("Resume name")).toHaveValue(/Marcus Bennett \(imported\) — Senior Backend Engineer, Payments at Northbridge Finance/);
  await expect(page.getByRole("button", { name: "Remove Apache Kafka" })).toBeVisible();
  await page.getByRole("link", { name: "Back to your resumes" }).click();
  await page.getByRole("link", { name: "Marcus Bennett (imported)", exact: true }).click();
  // "Kafka" appears in the skills list and in a role's technologies; both are unchanged in the original.
  await expect(page.getByRole("button", { name: "Remove Kafka", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Remove Apache Kafka" })).toHaveCount(0);
});
