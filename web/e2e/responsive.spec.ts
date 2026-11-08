/**
 * Responsive layout check on phone, tablet, laptop and desktop sizes:
 * no horizontal scrolling, header items never overlap, nothing sticks out of
 * the screen. Screenshots of every page and size go to e2e/.results/responsive.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = "e2e/.results/responsive";

const SIZES = [
  { name: "phone-small", width: 360, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
];

/** Layout problems a user would see as "messy". */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
    }
    // Header: logo, nav links and status must not overlap each other.
    const header = document.querySelector("header");
    if (header) {
      const parts = [...header.querySelectorAll("a, [role=status]")].map((el) => ({ el, r: el.getBoundingClientRect() }));
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i]!.r;
          const b = parts[j]!.r;
          if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
            problems.push(`header items overlap: "${parts[i]!.el.textContent?.trim()}" / "${parts[j]!.el.textContent?.trim()}"`);
          }
        }
      }
      if (header.getBoundingClientRect().height > 64) problems.push("header wraps onto several lines");
    }
    // Visible buttons and links must be fully on screen horizontally.
    for (const el of document.querySelectorAll<HTMLElement>("button, a, select, input")) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || style.visibility === "hidden" || el.closest("[hidden], dialog:not([open])")) continue;
      if (r.right > vw + 1 || r.left < -1) problems.push(`off screen: <${el.tagName.toLowerCase()}> "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
    }
    return [...new Set(problems)];
  });
}

async function check(page: Page, size: string, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${size}/${name}.png`, fullPage: false });
  expect(await layoutProblems(page), `${name} at ${size}`).toEqual([]);
}

for (const size of SIZES) {
  test(`layout at ${size.name} (${size.width}x${size.height})`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase("resume-builder");
          req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
        }),
    );
    await page.goto("/");
    await check(page, size.name, "01-home");
    await page.goto("/resumes");
    await check(page, size.name, "02-resumes-empty");
    await page.goto("/import");
    await check(page, size.name, "03-import");
    await page.getByLabel("Resume file").setInputFiles(`${ROOT}fixtures/rendered/02_senior_software_engineer.classic.pdf`);
    await expect(page.getByRole("heading", { name: "Check your imported resume" })).toBeVisible({ timeout: 20_000 });
    await check(page, size.name, "04-import-review");
    await page.getByRole("button", { name: "Continue to editor" }).click();
    await expect(page.getByLabel("Resume name")).toBeVisible();
    await check(page, size.name, "05-editor");

    const wide = size.width >= 1024;
    for (const tab of ["Preview", "Analysis", "Improve"]) {
      await page.getByRole("tab", { name: tab }).first().click();
      // Analysis renders the PDF and calls the engine; allow for a busy machine.
      if (tab === "Analysis") await expect(page.getByRole("region", { name: "Resume Quality score" })).toBeVisible({ timeout: 60_000 });
      await check(page, size.name, `06-editor-${tab.toLowerCase()}${wide ? "" : "-tab"}`);
    }

    await page.getByRole("link", { name: "Tailor to a job" }).click();
    await check(page, size.name, "07-tailor-start");
    await page.getByLabel("Job description", { exact: true }).fill(readFileSync(`${ROOT}fixtures/jobs/backend_engineer.txt`, "utf8"));
    await page.getByRole("button", { name: "Compare and tailor" }).click();
    await expect(page.getByRole("region", { name: "Job Match score" })).toBeVisible({ timeout: 20_000 });
    await check(page, size.name, "08-tailor");
    await page.getByRole("tab", { name: "Cover letter" }).click();
    await check(page, size.name, "09-tailor-cover-letter");

    await page.goto("/jobs");
    await check(page, size.name, "10-applications");
    await page.goto("/resumes");
    await check(page, size.name, "11-resumes");
    await page.goto("/privacy");
    await check(page, size.name, "12-privacy");
  });
}
