import { expect, test } from "@playwright/test";

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

const TEXT = `Sam Lee
sam.lee@example.com
EXPERIENCE
Supervisor | Corner Shop | Jan 2023 – Present
- I led a team of 4 cashiers.
- Responsible for stock checks.
Assistant | Cafe | 2020 – 2022
- Serve customers at the counter.`;

test("general improvements: safe fixes apply, prompts ask, nothing is invented", async ({ page }) => {
  await page.goto("/import");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByLabel("Resume text").fill(TEXT);
  await page.getByRole("button", { name: "Import text" }).click();
  await page.getByRole("button", { name: "Continue to editor" }).click({ timeout: 20_000 });

  await page.getByRole("tab", { name: "Improve" }).first().click();
  const list = page.getByRole("list", { name: "Improvement suggestions" });
  const firstPerson = list.getByRole("listitem", { name: "Drop “I” from this bullet" });
  await expect(firstPerson).toBeVisible({ timeout: 20_000 });
  await firstPerson.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByLabel("What you did and achieved 1").first()).toHaveValue("Led a team of 4 cashiers.");

  const tense = list.getByRole("listitem", { name: "Use past tense for a role you have left" });
  await tense.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByLabel("What you did and achieved 1").nth(1)).toHaveValue("Served customers at the counter.");

  // Duty-style bullet: the user rewrites it; "Save" stays disabled until they change it.
  const weak = list.getByRole("listitem", { name: /Rewrite “responsible for”/ });
  await expect(weak.getByRole("button", { name: "Save" })).toBeDisabled();
  await weak.getByLabel("Edit suggestion").fill("Ran weekly stock checks across two storerooms.");
  await weak.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("What you did and achieved 2").first()).toHaveValue("Ran weekly stock checks across two storerooms.");

  await expect(page.getByRole("button", { name: "Improve wording with AI" })).toBeDisabled();
});
