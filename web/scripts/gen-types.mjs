// Generates TypeScript types from the engine's JSON Schemas in shared/schema.
// The Python models (engine/src/resume_engine) are the single source of truth.
//   npm run gen:types            write the files
//   node scripts/gen-types.mjs --check   fail if any file is stale
import { compile } from "json-schema-to-typescript";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGETS = [
  { schema: "resume.schema.json", out: "resume.generated.ts", name: "Resume", source: "engine/src/resume_engine/schema" },
  { schema: "analysis.schema.json", out: "analysis.generated.ts", name: "AnalysisResult", source: "engine/src/resume_engine/analysis/models.py" },
  { schema: "jobs.schema.json", out: "jobs.generated.ts", name: "JobsContract", source: "engine/src/resume_engine/jobs" },
];

// Pydantic gives every property a "title"; json-schema-to-typescript would turn each
// into a named alias (Id1, Id2, Title3...). Keep titles only on model definitions.
function stripPropertyTitles(node) {
  if (Array.isArray(node)) return node.forEach(stripPropertyTitles);
  if (!node || typeof node !== "object") return;
  if (node.properties) {
    for (const prop of Object.values(node.properties)) {
      delete prop.title;
      stripPropertyTitles(prop);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "properties") stripPropertyTitles(value);
  }
}

const check = process.argv.includes("--check");
let stale = false;

for (const target of TARGETS) {
  const schemaPath = fileURLToPath(new URL(`../../shared/schema/${target.schema}`, import.meta.url));
  const outPath = fileURLToPath(new URL(`../src/types/${target.out}`, import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  stripPropertyTitles(schema);

  const ts = await compile(schema, target.name, {
    bannerComment: [
      "/* eslint-disable */",
      "/**",
      " * GENERATED FILE - DO NOT EDIT.",
      ` * Source: shared/schema/${target.schema} (from ${target.source}).`,
      " * Regenerate: npm run gen:types",
      " */",
    ].join("\n"),
    additionalProperties: false,
    strictIndexSignatures: true,
    style: { singleQuote: false },
  });
  const output = ts.replace(/\r\n/g, "\n");

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
    if (current !== output) {
      console.error(`src/types/${target.out} is stale. Run: npm run gen:types`);
      stale = true;
    }
  } else {
    writeFileSync(outPath, output);
    console.log(`wrote ${outPath}`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log("generated types are up to date");
}
