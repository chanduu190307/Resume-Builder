/** Thin client for the stateless resume engine (proxied at /api in dev). */
import type { AnalysisResult } from "../types/analysis.generated.ts";
import type { CoverLetter, FetchedJobOut, JobAnalysis, RewriteResult, Suggestion, TailorResponse } from "../types/jobs.generated.ts";
import type { Resume } from "../types/resume.ts";

export interface Health {
  status: "ok";
  engine_version: string;
  schema_version: string;
  ai_available: boolean;
  ai_status: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

/**
 * Full URL of an engine endpoint. Locally the engine is proxied at /api (same origin). When the web
 * app is hosted separately (e.g. a Render static site), set VITE_API_BASE at build time to the
 * engine's URL, e.g. https://resume-engine.onrender.com, and allow this site's origin in the
 * engine's RESUME_ENGINE_CORS_ORIGINS.
 */
export function apiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");
  return `${base}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, body);
    warnIfEngineMissing(apiUrl(path), err);
    throw err;
  }
  return body as T;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request<Health>("/api/health", { signal });
}

// ----------------------------------------------------------------------------- import

export interface ImportResponse {
  resume: Resume;
  source: "pdf" | "docx" | "text";
  method: "rules" | "llm" | "llm-ocr";
  warnings: string[];
  unplaced: string[];
  notes: string[];
  extracted_text: string;
}

/** Turns an API failure into a sentence the user can act on. */
const ENGINE_UNREACHABLE =
  "The resume engine (the server that reads your file) is not reachable right now, so the file could not be read. Please try again later.";

/** A 404/405 without the engine's JSON body: the request reached a web host that has no engine. */
function engineMissing(err: ApiError): boolean {
  return (err.status === 404 || err.status === 405) && err.body === null;
}

export function describeImportError(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: { message?: string } | string } | null)?.detail;
    if (detail && typeof detail === "object" && detail.message) return detail.message;
    if (err.status === 413) return "The file is larger than 5 MB.";
    if (err.status >= 500 || engineMissing(err)) return ENGINE_UNREACHABLE;
    return "The resume could not be imported.";
  }
  if (err instanceof DOMException && err.name === "AbortError") return "Import cancelled.";
  return ENGINE_UNREACHABLE;
}

/** Developer hint in the console when the engine is not where the app expects it. */
function warnIfEngineMissing(url: string, err: ApiError): void {
  if (engineMissing(err)) {
    console.warn(
      `Resume engine not found at ${url}. Locally, start it with scripts/dev.ps1. If the web app is hosted ` +
        "separately (Netlify, Render static site...), set VITE_API_BASE to the engine's URL at build time and " +
        "allow this site in the engine's RESUME_ENGINE_CORS_ORIGINS.",
    );
  }
}

export async function importResumeFile(file: File, signal?: AbortSignal): Promise<ImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl("/api/import/file"), { method: "POST", body: form, signal });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, body);
    warnIfEngineMissing(apiUrl("/api/import/file"), err);
    throw err;
  }
  return body as ImportResponse;
}

export function importResumeText(text: string, signal?: AbortSignal): Promise<ImportResponse> {
  return request<ImportResponse>("/api/import/text", { method: "POST", body: JSON.stringify({ text }), signal });
}

// ----------------------------------------------------------------------------- analysis

export type CareerLevel = "auto" | "early" | "experienced";

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function analyzeResume(
  resume: Resume,
  pdf: Blob | null,
  careerLevel: CareerLevel,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const pdf_base64 = pdf ? await blobToBase64(pdf) : null;
  return request<AnalysisResult>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ resume, pdf_base64, career_level: careerLevel }),
    signal,
  });
}

// ----------------------------------------------------------------------------- jobs

/** Readable message for any engine error response ({detail: {message}}), with a fallback. */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: { message?: string } } | null)?.detail;
    if (detail && typeof detail === "object" && detail.message) return detail.message;
    if (err.status >= 500 || engineMissing(err)) return ENGINE_UNREACHABLE;
    return fallback;
  }
  if (err instanceof DOMException && err.name === "AbortError") return "Cancelled.";
  return ENGINE_UNREACHABLE;
}

export function fetchJobFromUrl(url: string, signal?: AbortSignal): Promise<FetchedJobOut> {
  return request<FetchedJobOut>("/api/jobs/fetch", { method: "POST", body: JSON.stringify({ url }), signal });
}

export function analyzeJob(text: string, title?: string | null, company?: string | null, signal?: AbortSignal): Promise<JobAnalysis> {
  return request<JobAnalysis>("/api/jobs/analyze", {
    method: "POST",
    body: JSON.stringify({ text, title: title || null, company: company || null }),
    signal,
  });
}

export function matchJob(resume: Resume, job: JobAnalysis, signal?: AbortSignal): Promise<TailorResponse> {
  return request<TailorResponse>("/api/jobs/match", { method: "POST", body: JSON.stringify({ resume, job }), signal });
}

export function rewriteForJob(resume: Resume, job: JobAnalysis, signal?: AbortSignal): Promise<RewriteResult> {
  return request<RewriteResult>("/api/jobs/rewrite", { method: "POST", body: JSON.stringify({ resume, job }), signal });
}

// ----------------------------------------------------------------------------- general enhancement

export function enhanceResume(resume: Resume, signal?: AbortSignal): Promise<{ suggestions: Suggestion[] }> {
  return request<{ suggestions: Suggestion[] }>("/api/enhance", { method: "POST", body: JSON.stringify({ resume }), signal });
}

export function enhanceWithAi(resume: Resume, signal?: AbortSignal): Promise<RewriteResult> {
  return request<RewriteResult>("/api/enhance/rewrite", { method: "POST", body: JSON.stringify({ resume }), signal });
}

export function draftCoverLetter(resume: Resume, job: JobAnalysis, polishWithAi: boolean, signal?: AbortSignal): Promise<CoverLetter> {
  return request<CoverLetter>("/api/jobs/cover-letter", {
    method: "POST",
    body: JSON.stringify({ resume, job, polish_with_ai: polishWithAi }),
    signal,
  });
}
