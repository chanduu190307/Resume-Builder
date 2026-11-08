/**
 * Cross-checks that the web side reads the same contract as the engine:
 * every golden fixture must validate against the engine's input schema, and
 * a fully-populated resume must validate against the output schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Resume } from "./resume.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(root + rel, "utf8"));

// strict: false - Pydantic emits an OpenAPI-style "discriminator" keyword that Ajv
// does not need; the oneOf + const "type" fields already discriminate sections.
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateInput = ajv.compile(readJson("shared/schema/resume.input.schema.json") as object);
const validateOutput = ajv.compile(readJson("shared/schema/resume.schema.json") as object);

const fixtureFiles = readdirSync(root + "fixtures/resumes").filter((f) => f.endsWith(".json"));

describe("golden fixtures", () => {
  it("exist", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtureFiles)("%s validates against the input schema", (file) => {
    const ok = validateInput(readJson(`fixtures/resumes/${file}`));
    expect(validateInput.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe("output schema", () => {
  const complete: Resume = {
    schema_version: "1.0",
    id: "r1",
    meta: { title: "Test", template: "classic", page_size: "A4" },
    contact: { full_name: "Test Person", headline: null, email: null, phone: null, location: null, links: [] },
    sections: [
      {
        id: "s1",
        type: "experience",
        title: "Experience",
        visible: true,
        items: [
          {
            id: "e1",
            title: "Engineer",
            organization: "Example Co",
            location: null,
            employment_type: "full_time",
            start: { year: 2020, month: 1 },
            end: null,
            current: true,
            technologies: [],
            bullets: [{ id: "b1", text: "Did a thing", origin: "user" }],
          },
        ],
      },
    ],
  };

  it("accepts a complete typed resume", () => {
    expect(validateOutput(complete)).toBe(true);
  });

  it("rejects unknown fields", () => {
    const bad = { ...complete, nickname: "x" };
    expect(validateOutput(bad)).toBe(false);
  });

  it("rejects an unknown section type", () => {
    const bad = { ...complete, sections: [{ id: "s", type: "hobbies", title: "x", visible: true, items: [] }] };
    expect(validateOutput(bad)).toBe(false);
  });
});
