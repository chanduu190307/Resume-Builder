import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidatesFrom, inlineSource, sourceFiles } from "./tailwindScanFallback.ts";

describe("tailwind scan fallback", () => {
  it("collects source files but skips tests, dependencies and dot-folders", () => {
    const dir = mkdtempSync(join(tmpdir(), "twfb-"));
    for (const d of ["components", "node_modules/x", ".cache"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ["App.tsx", "components/Card.tsx", "lib.ts", "App.test.tsx", "notes.md", "node_modules/x/a.tsx", ".cache/b.tsx"]) {
      writeFileSync(join(dir, f), "");
    }
    const found = sourceFiles(dir).map((f) => f.slice(dir.length + 1).replaceAll("\\", "/")).sort();
    expect(found).toEqual(["App.tsx", "components/Card.tsx", "lib.ts"]);
  });

  it("finds class candidates in file contents, including variants and arbitrary values", () => {
    const found = candidatesFrom([{ content: '<div className="flex sm:inline max-w-[1400px] hover:bg-subtle/80" />', extension: "tsx" }]);
    expect(found).toEqual(expect.arrayContaining(["flex", "sm:inline", "max-w-[1400px]", "hover:bg-subtle/80"]));
  });

  it("builds a safe, sorted, de-duplicated @source inline() rule", () => {
    expect(inlineSource(["sm:inline", "flex", "flex", 'say"hi', "a{b,c}", "back\\slash", "max-w-[1400px]"])).toBe(
      '@source inline("flex max-w-[1400px] sm:inline");',
    );
  });
});
