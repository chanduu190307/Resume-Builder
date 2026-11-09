/**
 * Fallback for machines where Tailwind cannot read the project's files.
 *
 * Tailwind finds class names by scanning source files with a native engine
 * (@tailwindcss/oxide). On this project's Windows PC, Smart App Control blocked that native file;
 * Tailwind then silently uses its WebAssembly build, which can scan text it is given but cannot
 * read files from disk. Result: no utility classes at all, and every page is unstyled.
 *
 * This plugin checks once at startup whether Tailwind's scanner can see `src/`. Only if it cannot,
 * it reads the source files itself, extracts class candidates with Tailwind's own content scanner
 * (which works in WebAssembly too), and appends them to the main stylesheet as
 * `@source inline("...")`. Where the native engine works (Linux / Render, most PCs) it does nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import type { Plugin } from "vite";

const EXTENSIONS = new Set([".ts", ".tsx", ".html"]);

/** Source files whose class names Tailwind needs (no tests, no dependencies, no dot-folders). */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (EXTENSIONS.has(extname(name)) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** True if Tailwind's own scanner can read files in `dir` (false when only the WebAssembly build loads). */
export function scannerCanReadFiles(dir: string): boolean {
  const scanner = new Scanner({ sources: [{ base: dir, pattern: "**/*", negated: false }] });
  scanner.scan();
  return scanner.files.length > 0;
}

export function candidatesFrom(files: { content: string; extension: string }[]): string[] {
  return new Scanner({}).scanFiles(files);
}

/**
 * `@source inline("a b c");` for the given candidates. Candidates that could break the inline
 * syntax (quotes, backslashes, braces, which inline() treats as brace expansion) are skipped; real
 * class names never contain them.
 */
export function inlineSource(candidates: string[]): string {
  const safe = [...new Set(candidates)].filter((c) => c && !/["'\\{}\s;]/.test(c)).sort();
  return `@source inline("${safe.join(" ")}");`;
}

export function tailwindScanFallback(options: { root: string; css: string }): Plugin {
  const srcDir = resolve(options.root, "src");
  const cssFile = resolve(options.root, options.css).replaceAll("\\", "/");
  const extraFiles = [resolve(options.root, "index.html")].filter((f) => existsSync(f));
  let enabled = false;

  const collect = () =>
    candidatesFrom(
      [...sourceFiles(srcDir), ...extraFiles].map((file) => ({ content: readFileSync(file, "utf8"), extension: extname(file).slice(1) })),
    );

  return {
    name: "tailwind-scan-fallback",
    enforce: "pre", // must be listed before tailwindcss() so the stylesheet is extended first
    configResolved(config) {
      enabled = !scannerCanReadFiles(srcDir);
      if (enabled) {
        config.logger.warn(
          "[tailwind-scan-fallback] Tailwind's native file scanner is unavailable on this machine " +
            "(e.g. blocked by Windows Smart App Control); passing the project's class names to Tailwind directly.",
        );
      }
    },
    transform(code, id) {
      if (!enabled || id.split("?")[0]!.replaceAll("\\", "/") !== cssFile) return null;
      return { code: `${code}\n${inlineSource(collect())}\n`, map: null };
    },
    handleHotUpdate(ctx) {
      // A changed component may use new classes: rebuild the stylesheet too.
      if (!enabled || !EXTENSIONS.has(extname(ctx.file))) return;
      const css = ctx.server.moduleGraph.getModulesByFile(cssFile);
      if (!css?.size) return;
      for (const mod of css) ctx.server.moduleGraph.invalidateModule(mod);
      return [...ctx.modules, ...css];
    },
  };
}
