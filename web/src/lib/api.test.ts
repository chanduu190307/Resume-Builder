import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api.ts";

describe("apiUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stays relative when no engine URL is configured (local dev proxy)", () => {
    vi.stubEnv("VITE_API_BASE", "");
    expect(apiUrl("/api/health")).toBe("/api/health");
  });

  it("prefixes the configured engine URL, ignoring trailing slashes and spaces", () => {
    vi.stubEnv("VITE_API_BASE", " https://resume-engine.onrender.com/ ");
    expect(apiUrl("/api/import/file")).toBe("https://resume-engine.onrender.com/api/import/file");
  });
});

describe("describeImportError", () => {
  it("explains that the engine is unreachable when a web host answers 404 without the engine's JSON", async () => {
    const { ApiError, describeImportError } = await import("./api.ts");
    expect(describeImportError(new ApiError(404, null))).toMatch(/resume engine .* is not reachable/);
    expect(describeImportError(new ApiError(405, null))).toMatch(/not reachable/);
    expect(describeImportError(new ApiError(503, null))).toMatch(/not reachable/);
    expect(describeImportError(new TypeError("Failed to fetch"))).toMatch(/not reachable/);
  });

  it("keeps the engine's own messages and other cases", async () => {
    const { ApiError, describeImportError } = await import("./api.ts");
    expect(describeImportError(new ApiError(422, { detail: { message: "This file type is not supported." } }))).toBe(
      "This file type is not supported.",
    );
    expect(describeImportError(new ApiError(413, null))).toBe("The file is larger than 5 MB.");
    expect(describeImportError(new ApiError(404, { detail: "Not Found" }))).toBe("The resume could not be imported.");
  });
});
