/**
 * Browser storage (IndexedDB). There are no accounts: this is the only place
 * resumes and saved jobs live, so writes are explicit and nothing is dropped
 * silently.
 *
 * Schema history:  v1 resumes  ->  v2 + jobs (tailoring sessions / application tracker)  ->  v3 + versions
 */
import type { JobAnalysis } from "../../types/jobs.generated.ts";
import type { Resume } from "../../types/resume.ts";

export const DB_NAME = "resume-builder";
const DB_VERSION = 3;
const RESUMES = "resumes";
const JOBS = "jobs";
const VERSIONS = "versions";
/** Automatic restore points kept per resume (named versions are never pruned). */
export const MAX_AUTO_VERSIONS = 20;

export interface StoredResume {
  id: string;
  resume: Resume;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus = "saved" | "applied" | "interview" | "offer" | "rejected" | "withdrawn";

/** A job the user is tailoring a resume for (and, later, tracking an application to). */
export interface JobRecord {
  id: string;
  title: string;
  company: string;
  url: string | null;
  text: string;
  analysis: JobAnalysis;
  baseResumeId: string;
  /** The tailored copy. The base resume is never modified by tailoring. */
  tailoredResumeId: string;
  /** Snapshot of the base resume when tailoring started, for the comparison view. */
  original: Resume;
  rejectedSuggestions: string[];
  status: ApplicationStatus;
  notes: string;
  /** Last Job Match Score seen in the tailoring workspace. */
  lastScore?: number | null;
  appliedAt?: string | null;
  coverLetter?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A saved copy of a resume at a point in time. */
export interface ResumeVersion {
  id: string;
  resumeId: string;
  label: string;
  /** Automatic restore point (pruned after MAX_AUTO_VERSIONS) vs a version the user named. */
  auto: boolean;
  resume: Resume;
  createdAt: string;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

/** One open connection per factory, shared by every store. */
class Database {
  #db: Promise<IDBDatabase> | null = null;

  constructor(readonly factory: IDBFactory) {}

  open(): Promise<IDBDatabase> {
    if (!this.#db) {
      this.#db = new Promise((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(RESUMES)) db.createObjectStore(RESUMES, { keyPath: "id" });
          if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
          if (!db.objectStoreNames.contains(VERSIONS)) db.createObjectStore(VERSIONS, { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          // Another tab is upgrading or deleting the database: release it.
          db.onversionchange = () => {
            db.close();
            this.#db = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Storage is blocked by another open tab."));
      });
      this.#db.catch(() => (this.#db = null));
    }
    return this.#db;
  }

  async deleteAll(): Promise<void> {
    const db = await this.open();
    db.close();
    this.#db = null;
    await new Promise<void>((resolve, reject) => {
      const request = this.factory.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other tabs of this app and try again."));
    });
  }

  async getAll<T>(store: string): Promise<T[]> {
    const db = await this.open();
    return promisify(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: string, id: string): Promise<T | undefined> {
    const db = await this.open();
    return promisify(db.transaction(store).objectStore(store).get(id) as IDBRequest<T | undefined>);
  }

  /** Change an existing record in one transaction; returns undefined if it does not exist. */
  async modify<T>(store: string, id: string, change: (existing: T) => T): Promise<T | undefined> {
    const db = await this.open();
    const tx = db.transaction(store, "readwrite");
    const completed = done(tx);
    const os = tx.objectStore(store);
    const existing = await promisify(os.get(id) as IDBRequest<T | undefined>);
    if (existing === undefined) {
      await completed;
      return undefined;
    }
    const record = change(existing);
    os.put(record);
    await completed;
    return record;
  }

  async delete(store: string, id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await done(tx);
  }

  /** Read-modify-write in one transaction. */
  async upsert<T>(store: string, id: string, build: (existing: T | undefined) => T): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    const existing = await promisify(os.get(id) as IDBRequest<T | undefined>);
    const record = build(existing);
    os.put(record);
    await done(tx);
    return record;
  }
}

export class ResumeStore {
  readonly db: Database;

  constructor(
    factory: IDBFactory | Database = globalThis.indexedDB,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = factory instanceof Database ? factory : new Database(factory);
  }

  /** All resumes, most recently edited first. */
  async list(): Promise<StoredResume[]> {
    const records = await this.db.getAll<StoredResume>(RESUMES);
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Promise<StoredResume | undefined> {
    return this.db.get<StoredResume>(RESUMES, id);
  }

  /** Insert or update. Keeps the original creation time. */
  save(resume: Resume): Promise<StoredResume> {
    const timestamp = this.now().toISOString();
    return this.db.upsert<StoredResume>(RESUMES, resume.id, (existing) => ({
      id: resume.id,
      resume,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
  }

  delete(id: string): Promise<void> {
    return this.db.delete(RESUMES, id);
  }

  /** Permanently removes every resume and saved job stored by this app in this browser. */
  deleteAll(): Promise<void> {
    return this.db.deleteAll();
  }
}

export class JobStore {
  constructor(
    readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<JobRecord[]> {
    const records = await this.db.getAll<JobRecord>(JOBS);
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Promise<JobRecord | undefined> {
    return this.db.get<JobRecord>(JOBS, id);
  }

  save(job: Omit<JobRecord, "createdAt" | "updatedAt"> & Partial<Pick<JobRecord, "createdAt">>): Promise<JobRecord> {
    const timestamp = this.now().toISOString();
    return this.db.upsert<JobRecord>(JOBS, job.id, (existing) => ({
      ...job,
      createdAt: existing?.createdAt ?? job.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
  }

  /** Apply a change to a saved job (no-op if it was deleted meanwhile). */
  update(id: string, change: (job: JobRecord) => JobRecord): Promise<JobRecord | undefined> {
    const timestamp = this.now().toISOString();
    return this.db.modify<JobRecord>(JOBS, id, (existing) => ({ ...change(existing), updatedAt: timestamp }));
  }

  delete(id: string): Promise<void> {
    return this.db.delete(JOBS, id);
  }
}

export class VersionStore {
  constructor(
    readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly makeId: () => string = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12),
  ) {}

  /** Versions of one resume, newest first. */
  async list(resumeId: string): Promise<ResumeVersion[]> {
    const all = await this.db.getAll<ResumeVersion>(VERSIONS);
    return all.filter((v) => v.resumeId === resumeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAll(): Promise<ResumeVersion[]> {
    return this.db.getAll<ResumeVersion>(VERSIONS);
  }

  async save(resume: Resume, label: string, auto: boolean): Promise<ResumeVersion> {
    const version: ResumeVersion = {
      id: this.makeId(),
      resumeId: resume.id,
      label,
      auto,
      resume: structuredClone(resume),
      createdAt: this.now().toISOString(),
    };
    await this.db.upsert<ResumeVersion>(VERSIONS, version.id, () => version);
    if (auto) {
      const autos = (await this.list(resume.id)).filter((v) => v.auto);
      for (const old of autos.slice(MAX_AUTO_VERSIONS)) await this.db.delete(VERSIONS, old.id);
    }
    return version;
  }

  /** Store a version exactly as given (used when restoring a backup). */
  async put(version: ResumeVersion): Promise<void> {
    await this.db.upsert<ResumeVersion>(VERSIONS, version.id, () => version);
  }

  delete(id: string): Promise<void> {
    return this.db.delete(VERSIONS, id);
  }

  async deleteForResume(resumeId: string): Promise<void> {
    for (const v of await this.list(resumeId)) await this.db.delete(VERSIONS, v.id);
  }
}

let defaultResumes: ResumeStore | null = null;
let defaultVersions: VersionStore | null = null;
let defaultJobs: JobStore | null = null;

export function getStore(): ResumeStore {
  defaultResumes ??= new ResumeStore();
  return defaultResumes;
}

export function getJobStore(): JobStore {
  defaultJobs ??= new JobStore(getStore().db);
  return defaultJobs;
}

export function getVersionStore(): VersionStore {
  defaultVersions ??= new VersionStore(getStore().db);
  return defaultVersions;
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
