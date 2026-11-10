import { describe, expect, it } from "vitest";
import { createResume } from "../factories.ts";
import { formatDate, formatRange } from "../format/dates.ts";
import { displayUrl, toHref } from "../format/links.ts";
import { FIXTURE_FILES, loadFixture } from "../../test/fixtures.ts";
import { expectedText, squash } from "../../test/visibleText.ts";
import { buildDocument, documentText } from "./buildDocument.ts";

describe("formatting", () => {
  it("formats dates and ranges consistently", () => {
    expect(formatDate({ year: 2025, month: 6 })).toBe("Jun 2025");
    expect(formatDate({ year: 2025, month: null })).toBe("2025");
    expect(formatRange({ year: 2025, month: 6 }, { year: 2025, month: 8 })).toBe("Jun 2025 – Aug 2025");
    expect(formatRange({ year: 2021, month: 3 }, null, true)).toBe("Mar 2021 – Present");
    expect(formatRange(null, { year: 2019, month: null })).toBe("2019");
    expect(formatRange({ year: 2020, month: null }, { year: 2020, month: null })).toBe("2020");
    expect(formatRange(null, null)).toBe("");
  });

  it("formats links", () => {
    expect(displayUrl("https://www.linkedin.com/in/x/")).toBe("linkedin.com/in/x");
    expect(toHref("linkedin.com/in/x")).toBe("https://linkedin.com/in/x");
    expect(toHref("http://x.org")).toBe("http://x.org");
  });
});

describe("buildDocument", () => {
  it.each(FIXTURE_FILES)("%s: includes every visible field and no hidden ones", (file) => {
    const resume = loadFixture(file);
    const text = squash(documentText(buildDocument(resume)).join("\n"));
    const { visible, hidden } = expectedText(resume);
    const missing = visible.filter((v) => !text.includes(squash(v)));
    expect(missing).toEqual([]);
    const leaked = hidden.filter((h) => text.includes(squash(h)));
    expect(leaked).toEqual([]);
  });

  it("skips empty items and sections so blank form rows never print", () => {
    const doc = buildDocument(createResume());
    expect(doc.sections).toEqual([]);
    expect(doc.contact).toEqual([]);
  });

  it("does not add content the user did not write", () => {
    const resume = createResume();
    resume.contact.full_name = "Only Name";
    const words = documentText(buildDocument(resume));
    expect(words).toEqual(["Only Name"]);
  });
});

describe("certifications", () => {
  it("shows the description under the issuer, before the credential ID", () => {
    const resume = createResume("Test");
    resume.sections = [
      {
        id: "s1", type: "certifications", title: "Certifications", visible: true,
        items: [{
          id: "c1", name: "Cloud Basics", issuer: "Example Cloud Academy", issued: null, expires: null,
          credential_id: "ABC-123", url: null, description: "Learned core cloud concepts and basic security practices.",
        }],
      },
    ] as typeof resume.sections;
    const text = documentText(buildDocument(resume)).join("\n");
    expect(text).toContain("Cloud Basics");
    const order = ["Example Cloud Academy", "Learned core cloud concepts and basic security practices.", "ABC-123"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
