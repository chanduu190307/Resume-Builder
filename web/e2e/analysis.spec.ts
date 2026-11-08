import { expect, test } from "@playwright/test";

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

const WEAK = `Sam Lee
sam.lee@example.com | Leeds, UK
SUMMARY
I am a hard-working team player.
EXPERIENCE
Shop Assistant | Corner Shop | Jan 2022 – Present
- Responsible for customers.
- I worked on the till.
EDUCATION
BSc Business | University of Leeds | 2018 – 2021`;

test("analysis shows explained scores and jumps to the problem", async ({ page }) => {
  // Import a weak resume so there are findings to act on.
  await page.goto("/import");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByLabel("Resume text").fill(WEAK);
  await page.getByRole("button", { name: "Import text" }).click();
  await page.getByRole("button", { name: "Continue to editor" }).click({ timeout: 20_000 });

  await page.getByRole("tab", { name: "Analysis" }).first().click();
  const quality = page.getByRole("region", { name: "Resume Quality score" });
  const parsing = page.getByRole("region", { name: "Parsing Readiness score" });
  await expect(quality).toContainText("/ 100", { timeout: 30_000 });
  await expect(parsing).toContainText("/ 100");
  const before = Number(await quality.getAttribute("data-score"));
  expect(before).toBeLessThan(70);

  const checks = page.getByRole("region", { name: "Issues" });
  await expect(checks).toContainText("No phone number.");
  await expect(checks).toContainText("“responsible for” describes duties rather than results");

  // "Go to" on the missing phone focuses the phone field.
  const phoneIssue = checks.getByRole("listitem").filter({ hasText: "No phone number." });
  await phoneIssue.getByRole("button", { name: "Go to" }).click();
  const phone = page.getByRole("region", { name: "Contact details" }).getByLabel("Phone");
  await expect(phone).toBeFocused();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/08-analysis.png`, fullPage: false });

  // Fixing problems raises the score (re-analysis runs automatically).
  await phone.fill("+44 7700 900123");
  await page.getByLabel("What you did and achieved 1").fill("Served about 60 customers a day and resolved complaints on the spot.");
  await page.getByLabel("What you did and achieved 2").fill("Balanced the till daily with zero discrepancies over 18 months.");
  await expect
    .poll(async () => Number(await quality.getAttribute("data-score")), { timeout: 30_000 })
    .toBeGreaterThan(before);
  await expect(checks).not.toContainText("No phone number.");

  // The ATS view shows the text read back from the exported PDF.
  await page.getByText("What an ATS sees").click();
  await expect(page.locator("pre").last()).toContainText("Corner Shop");
});
