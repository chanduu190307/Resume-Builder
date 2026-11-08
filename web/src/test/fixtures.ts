/**
 * Test helpers: load the golden fixtures (which omit ids/defaults, like the
 * engine's input schema allows) and fill in defaults exactly as the engine would,
 * then validate the result against the engine's output schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createBullet, createItem, createLink, createResume } from "../lib/factories.ts";
import { newId } from "../lib/ids.ts";
import type { Resume, Section, SectionType } from "../types/resume.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const FONT_DIR = fileURLToPath(new URL("../../public/fonts", import.meta.url));

const readJson = (rel: string): unknown => JSON.parse(readFileSync(REPO_ROOT + rel, "utf8"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
export const validateResume = ajv.compile(readJson("shared/schema/resume.schema.json") as object);

export const FIXTURE_FILES = readdirSync(REPO_ROOT + "fixtures/resumes").filter((f) => f.endsWith(".json"));

type Raw = Record<string, unknown>;

/** Year-only dates ({year}) get an explicit month: null, as the engine fills in. */
function withDateDefaults(raw: Raw): Raw {
  const out: Raw = { ...raw };
  for (const [key, value] of Object.entries(out)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "year" in value) {
      out[key] = { month: null, ...(value as Raw) };
    }
  }
  return out;
}

function withBullets(raw: Raw): Raw {
  if (!Array.isArray(raw.bullets)) return raw;
  return { ...raw, bullets: (raw.bullets as Raw[]).map((b) => ({ ...createBullet(), ...b })) };
}

export function normalizeResume(raw: Raw): Resume {
  const base = createResume();
  const contact = { ...base.contact, ...(raw.contact as Raw | undefined) } as Raw;
  contact.links = ((contact.links as Raw[] | undefined) ?? []).map((l) => ({ ...createLink(), ...l }));
  const sections = ((raw.sections as Raw[] | undefined) ?? []).map((s) => {
    const type = s.type as SectionType;
    const items = ((s.items as Raw[] | undefined) ?? []).map((it) => {
      const defaults = createItem(type) as unknown as Raw;
      if ("bullets" in defaults) defaults.bullets = [];
      return withDateDefaults(withBullets({ ...defaults, ...it }));
    });
    return { id: newId(), visible: true, ...s, items } as unknown as Section;
  });
  const resume = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw.meta as Raw | undefined) },
    contact,
    sections,
  } as unknown as Resume;
  if (!validateResume(resume)) {
    throw new Error(`normalized fixture is invalid: ${JSON.stringify(validateResume.errors, null, 2)}`);
  }
  return resume;
}

export function loadFixture(file: string): Resume {
  return normalizeResume(readJson(`fixtures/resumes/${file}`) as Raw);
}
