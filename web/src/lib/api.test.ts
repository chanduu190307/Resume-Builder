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
