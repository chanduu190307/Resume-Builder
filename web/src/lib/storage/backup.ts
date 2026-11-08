/**
 * Backup files. With no accounts, a backup file is the user's only copy outside
 * this browser, so restore validates strictly, imports nothing if anything is
 * invalid, and never overwrites existing data (conflicting ids get new ids, and
 * jobs/versions are re-linked to the renamed resumes).
 *
 * Format history: v1 resumes only  ->  v2 + saved jobs (applications) + versions.
 */
import { newId } from "../ids.ts";
import type { Resume } from "../../types/resume.ts";
import type { JobRecord, ResumeVersion } from "./db.ts";

export const BACKUP_FORMAT = "resume-builder-backup";
export const BACKUP_VERSION = 2;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  resumes: Resume[];
  jobs: JobRecord[];
  versions: ResumeVersion[];
}

export interface RestoredData {
  resumes: Resume[];
  jobs: JobRecord[];
  versions: ResumeVersion[];
}

export function createBackup(resumes: Resume[], jobs: JobRecord[] = [], versions: ResumeVersion[] = [], now = new Date()): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: now.toISOString(), resumes, jobs, versions };
}

export class BackupError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = "BackupError";
  }
}

type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };

let validatorPromise: Promise<Validator> | null = null;

/** The engine's output schema, compiled lazily so Ajv only loads when restoring. */
function getValidator(): Promise<Validator> {
  validatorPromise ??= Promise.all([
    import("ajv/dist/2020.js"),
    import("../../../../shared/schema/resume.schema.json"),
  ]).then(([{ Ajv2020 }, schema]) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    return ajv.compile((schema as { default?: object }).default ?? schema) as Validator;
  });
  return validatorPromise;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function checkJob(job: unknown, index: number, validate: Validator, problems: string[]): void {
  const where = `Job ${index + 1}`;
  if (!isObject(job)) return void problems.push(`${where}: not an object`);
  for (const key of ["id", "title", "company", "text", "baseResumeId", "tailoredResumeId", "status", "createdAt"]) {
    if (!isString(job[key])) problems.push(`${where}: missing ${key}`);
  }
  if (!isObject(job.analysis) || !Array.isArray(job.analysis.requirements) || !Array.isArray(job.analysis.keywords)) {
    problems.push(`${where}: invalid job analysis`);
  }
  if (!Array.isArray(job.rejectedSuggestions)) problems.push(`${where}: missing rejectedSuggestions`);
  if (!validate(job.original)) problems.push(`${where}: the original resume snapshot is invalid`);
}

function checkVersion(version: unknown, index: number, validate: Validator, problems: string[]): void {
  const where = `Version ${index + 1}`;
  if (!isObject(version)) return void problems.push(`${where}: not an object`);
  for (const key of ["id", "resumeId", "label", "createdAt"]) {
    if (!isString(version[key])) problems.push(`${where}: missing ${key}`);
  }
  if (typeof version.auto !== "boolean") problems.push(`${where}: missing auto`);
  if (!validate(version.resume)) problems.push(`${where}: the saved resume is invalid`);
}

export interface ExistingIds {
  resumes: Iterable<string>;
  jobs?: Iterable<string>;
  versions?: Iterable<string>;
}

/**
 * Parses a backup file (v1 or v2) or a single exported resume. Throws
 * BackupError with readable details if anything is invalid.
 */
export async function parseBackup(text: string, existing: ExistingIds): Promise<RestoredData> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("This file is not valid JSON.");
  }

  let resumes: unknown[];
  let jobs: unknown[] = [];
  let versions: unknown[] = [];
  if (isObject(data) && data.format === BACKUP_FORMAT) {
    if (data.version !== 1 && data.version !== 2) throw new BackupError(`Unsupported backup version: ${String(data.version)}.`);
    if (!Array.isArray(data.resumes)) throw new BackupError("The backup contains no resumes.");
    resumes = data.resumes;
    if (data.version === 2) {
      jobs = Array.isArray(data.jobs) ? data.jobs : [];
      versions = Array.isArray(data.versions) ? data.versions : [];
    }
  } else {
    resumes = [data];
  }

  const validate = await getValidator();
  const problems: string[] = [];
  resumes.forEach((resume, index) => {
    if (!validate(resume)) {
      for (const err of validate.errors ?? []) problems.push(`Resume ${index + 1}${err.instancePath || ""}: ${err.message ?? "invalid"}`);
    }
  });
  jobs.forEach((job, i) => checkJob(job, i, validate, problems));
  versions.forEach((version, i) => checkVersion(version, i, validate, problems));
  if (problems.length) throw new BackupError("This file does not contain a valid backup.", problems.slice(0, 20));

  // Never overwrite: give conflicting resumes new ids and re-link everything that points at them.
  const takenResumes = new Set(existing.resumes);
  const renamed = new Map<string, string>();
  const restoredResumes = (resumes as Resume[]).map((resume) => {
    if (!takenResumes.has(resume.id)) {
      takenResumes.add(resume.id);
      return resume;
    }
    const id = newId();
    takenResumes.add(id);
    renamed.set(resume.id, id);
    return { ...resume, id };
  });
  const relink = (id: string) => renamed.get(id) ?? id;

  const takenJobs = new Set(existing.jobs ?? []);
  const restoredJobs = (jobs as JobRecord[]).map((job) => {
    const id = takenJobs.has(job.id) ? newId() : job.id;
    takenJobs.add(id);
    return { ...job, id, baseResumeId: relink(job.baseResumeId), tailoredResumeId: relink(job.tailoredResumeId) };
  });

  const takenVersions = new Set(existing.versions ?? []);
  const restoredVersions = (versions as ResumeVersion[]).map((version) => {
    const id = takenVersions.has(version.id) ? newId() : version.id;
    takenVersions.add(id);
    const resumeId = relink(version.resumeId);
    return { ...version, id, resumeId, resume: { ...version.resume, id: resumeId } };
  });

  return { resumes: restoredResumes, jobs: restoredJobs, versions: restoredVersions };
}
