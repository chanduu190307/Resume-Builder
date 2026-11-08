import { describe, expect, it } from "vitest";
import { createResume } from "../factories.ts";
import { FIXTURE_FILES, loadFixture } from "../../test/fixtures.ts";
import type { Resume } from "../../types/resume.ts";
import { BackupError, createBackup, parseBackup } from "./backup.ts";
import type { JobRecord, ResumeVersion } from "./db.ts";

const NONE = { resumes: [] as string[] };

function jobFor(base: Resume, tailored: Resume): JobRecord {
  return {
    id: "job1", title: "Engineer", company: "Acme", url: null, text: "JD",
    analysis: { title: null, company: null, requirements: [], keywords: [], years_required: null, education_level: null,
      education_text: null, education_alternative: false, method: "rules", text: "JD" },
    baseResumeId: base.id, tailoredResumeId: tailored.id, original: base, rejectedSuggestions: [], status: "applied",
    notes: "Call back Friday", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

function versionOf(resume: Resume): ResumeVersion {
  return { id: "v1", resumeId: resume.id, label: "Before tailoring", auto: false, resume, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("backup", () => {
  it("round-trips resumes, applications and versions", async () => {
    const resumes = FIXTURE_FILES.map(loadFixture);
    const [base, tailored] = [resumes[0]!, resumes[1]!];
    const text = JSON.stringify(createBackup(resumes, [jobFor(base, tailored)], [versionOf(base)]));
    const restored = await parseBackup(text, NONE);
    expect(restored.resumes).toEqual(resumes);
    expect(restored.jobs[0]).toMatchObject({ notes: "Call back Friday", baseResumeId: base.id, tailoredResumeId: tailored.id });
    expect(restored.versions[0]).toMatchObject({ label: "Before tailoring", resumeId: base.id });
  });

  it("still restores version 1 backups (resumes only)", async () => {
    const r = createResume("Old");
    const v1 = { format: "resume-builder-backup", version: 1, exported_at: "2026-01-01T00:00:00Z", resumes: [r] };
    const restored = await parseBackup(JSON.stringify(v1), NONE);
    expect(restored.resumes).toEqual([r]);
    expect(restored.jobs).toEqual([]);
  });

  it("accepts a single exported resume", async () => {
    const resume = createResume("Solo");
    expect((await parseBackup(JSON.stringify(resume), NONE)).resumes).toEqual([resume]);
  });

  it("never overwrites: conflicting ids get new ids and links follow", async () => {
    const base = createResume("Base");
    const tailored = createResume("Tailored");
    const text = JSON.stringify(createBackup([base, tailored], [jobFor(base, tailored)], [versionOf(base)]));
    const restored = await parseBackup(text, { resumes: [base.id], jobs: ["job1"], versions: ["v1"] });
    const newBase = restored.resumes[0]!;
    expect(newBase.id).not.toBe(base.id);
    expect(restored.resumes[1]!.id).toBe(tailored.id);
    expect(restored.jobs[0]!.id).not.toBe("job1");
    expect(restored.jobs[0]!.baseResumeId).toBe(newBase.id);
    expect(restored.versions[0]!.id).not.toBe("v1");
    expect(restored.versions[0]!.resumeId).toBe(newBase.id);
    expect(restored.versions[0]!.resume.id).toBe(newBase.id);
  });

  it("rejects invalid JSON", async () => {
    await expect(parseBackup("{not json", NONE)).rejects.toBeInstanceOf(BackupError);
  });

  it("rejects invalid content with readable details and imports nothing", async () => {
    const good = createResume("Good");
    const bad = { ...createResume("Bad"), sections: [{ id: "x", type: "hobbies", title: "H", visible: true, items: [] }] };
    const error = await parseBackup(JSON.stringify(createBackup([good, bad as never])), NONE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).details[0]).toMatch(/^Resume 2/);

    const brokenJob = { ...jobFor(good, good), analysis: null };
    const jobError = await parseBackup(JSON.stringify(createBackup([good], [brokenJob as never])), NONE).catch((e: unknown) => e);
    expect((jobError as BackupError).details).toContain("Job 1: invalid job analysis");
  });

  it("rejects unsupported backup versions", async () => {
    const text = JSON.stringify({ ...createBackup([]), version: 99 });
    await expect(parseBackup(text, NONE)).rejects.toThrow(/Unsupported backup version/);
  });
});
