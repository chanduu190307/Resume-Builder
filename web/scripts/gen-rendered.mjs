// Renders the golden fixtures into fixtures/rendered/ for the engine's import tests.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "src/test/renderFixtures.gen.test.tsx"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, GEN_RENDERED: "1" },
});
process.exit(result.status ?? 1);
