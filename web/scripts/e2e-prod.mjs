// Runs the end-to-end tests against the production build (cross-platform env var).
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, E2E_PROD: "1" },
});
process.exit(result.status ?? 1);
