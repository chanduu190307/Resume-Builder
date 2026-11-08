/**
 * Automated accessibility audit (axe, WCAG 2.1 A/AA) of every page and panel.
 * Fails on serious or critical violations. Automated checks catch roughly a third
 * of accessibility problems; keyboard and screen-reader testing still matter.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function audit(page: Page, name: string) {
  // Let lazy content (PDF preview, analysis) settle so it is audited too.
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
  expect(report, `${name}:\n${report.join("\n")}`).toEqual([]);
}

test("every page meets WCAG 2.1 AA automated checks", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("resume-builder");
        req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
      }),
  );

  await page.goto("/");
  await audit(page, "home");
  await page.goto("/privacy");
  await audit(page, "privacy");
  await page.goto("/resumes");
  await audit(page, "library (empty)");
  await page.goto("/jobs");
  await audit(page, "applications (empty)");

  await page.goto("/import");
  await audit(page, "import");
  await page.getByLabel("Resume file").setInputFiles(`${ROOT}fixtures/rendered/02_senior_software_engineer.classic.pdf`);
  await expect(page.getByRole("heading", { name: "Check your imported resume" })).toBeVisible({ timeout: 20_000 });
  await audit(page, "import review");
  await page.getByRole("button", { name: "Continue to editor" }).click();
  await expect(page.getByLabel("Resume name")).toBeVisible();
  await audit(page, "editor + preview");

  await page.getByRole("tab", { name: "Analysis" }).first().click();
  await expect(page.getByRole("region", { name: "Resume Quality score" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Resume Quality breakdown" }).click();
  await audit(page, "editor + analysis");
  await page.getByRole("tab", { name: "Improve" }).first().click();
  await expect(page.getByText("Improvements that keep your facts exactly as they are.")).toBeVisible();
  await audit(page, "editor + improve");
  await page.getByRole("button", { name: "Version history" }).click();
  await audit(page, "version history dialog");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "Tailor to a job" }).click();
  await audit(page, "tailor start");
  await page.getByLabel("Job description", { exact: true }).fill(readFileSync(`${ROOT}fixtures/jobs/backend_engineer.txt`, "utf8"));
  await page.getByRole("button", { name: "Compare and tailor" }).click();
  await expect(page.getByRole("region", { name: "Job Match score" })).toBeVisible({ timeout: 20_000 });
  await audit(page, "tailor workspace");
  for (const tab of ["Changes", "Cover letter", "Job"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await audit(page, `tailor workspace: ${tab}`);
  }

  await page.goto("/jobs");
  await audit(page, "applications");
  await page.goto("/resumes");
  await audit(page, "library");
});
