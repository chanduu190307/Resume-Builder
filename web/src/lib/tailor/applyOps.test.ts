import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { diffWords } from "../diff.ts";
import { resumeReducer } from "../editor/reducer.ts";
import { JobStore, ResumeStore } from "../storage/db.ts";
import { FIXTURE_FILES, loadFixture, validateResume } from "../../test/fixtures.ts";
import type { EditOp } from "../../types/jobs.generated.ts";
import type { ItemOf, Resume } from "../../types/resume.ts";
import { planOps } from "./applyOps.ts";

const senior = () => loadFixture(FIXTURE_FILES.find((f) => f.startsWith("02"))!);

function op(partial: Partial<EditOp> & Pick<EditOp, "op">): EditOp {
  return { section_id: null, item_id: null, bullet_id: null, old: null, new: null, order: [], origin: "user", ...partial };
}

function apply(resume: Resume, ops: EditOp[], override?: string) {
  const plan = planOps(resume, ops, override);
  return { resume: plan.actions.reduce(resumeReducer, resume), stale: plan.stale };
}

const skillsGroup = (r: Resume, index = 0) => {
  const s = r.sections.find((x) => x.type === "skills")!;
  return { section: s, group: s.items[index] as ItemOf<"skills"> };
};
const firstRole = (r: Resume) => {
  const s = r.sections.find((x) => x.type === "experience")!;
  return { section: s, item: s.items[0] as ItemOf<"experience"> };
};

describe("planOps", () => {
  it("replaces a skill's wording", () => {
    const r = senior();
    const { section, group } = skillsGroup(r, 2); // PostgreSQL, MySQL, Redis, Kafka
    const out = apply(r, [op({ op: "replace_skill", section_id: section.id, item_id: group.id, old: "Kafka", new: "Apache Kafka" })]);
    expect(skillsGroup(out.resume, 2).group.skills).toEqual(["PostgreSQL", "MySQL", "Redis", "Apache Kafka"]);
    expect(validateResume(out.resume)).toBe(true);
  });

  it("adds a skill without duplicates, or creates a Skills section", () => {
    const r = senior();
    const { section, group } = skillsGroup(r);
    let out = apply(r, [op({ op: "add_skill", section_id: section.id, item_id: group.id, new: "gRPC" })]);
    expect(skillsGroup(out.resume).group.skills.at(-1)).toBe("gRPC");
    out = apply(out.resume, [op({ op: "add_skill", section_id: section.id, item_id: group.id, new: "grpc" })]);
    expect(skillsGroup(out.resume).group.skills.filter((s) => s.toLowerCase() === "grpc")).toHaveLength(1);

    const noSkills = { ...r, sections: r.sections.filter((s) => s.type !== "skills") };
    out = apply(noSkills, [op({ op: "add_skill", new: "Go" })]);
    expect(skillsGroup(out.resume).group.skills).toEqual(["Go"]);
    expect(validateResume(out.resume)).toBe(true);
  });

  it("reorders skills and bullets only when the set is unchanged", () => {
    const r = senior();
    const { section, group } = skillsGroup(r);
    const reordered = ["SQL", "Go", "Java", "Python"];
    expect(skillsGroup(apply(r, [op({ op: "reorder_skills", section_id: section.id, item_id: group.id, order: reordered })]).resume).group.skills).toEqual(reordered);
    const stale = apply(r, [op({ op: "reorder_skills", section_id: section.id, item_id: group.id, order: ["SQL", "Go"] })]);
    expect(stale.stale).toHaveLength(1);

    const role = firstRole(r);
    const ids = role.item.bullets.map((b) => b.id).reverse();
    const out = apply(r, [op({ op: "reorder_bullets", section_id: role.section.id, item_id: role.item.id, order: ids })]);
    expect(firstRole(out.resume).item.bullets.map((b) => b.id)).toEqual(ids);
  });

  it("refuses to overwrite text the user changed since the suggestion", () => {
    const r = senior();
    const role = firstRole(r);
    const bullet = role.item.bullets[0]!;
    const suggestion = op({
      op: "set_bullet_text", section_id: role.section.id, item_id: role.item.id, bullet_id: bullet.id,
      old: "something the user has since changed", new: "New text", origin: "ai_assisted",
    });
    const out = apply(r, [suggestion]);
    expect(out.stale).toHaveLength(1);
    expect(firstRole(out.resume).item.bullets[0]!.text).toBe(bullet.text);
  });

  it("marks accepted AI wording as ai_assisted, and the user's own edit as user", () => {
    const r = senior();
    const role = firstRole(r);
    const bullet = role.item.bullets[0]!;
    const base = { op: "set_bullet_text" as const, section_id: role.section.id, item_id: role.item.id, bullet_id: bullet.id, old: bullet.text };
    const ai = apply(r, [op({ ...base, new: "Led 5 engineers through a migration.", origin: "ai_assisted" })]);
    expect(firstRole(ai.resume).item.bullets[0]).toMatchObject({ text: "Led 5 engineers through a migration.", origin: "ai_assisted" });
    const own = apply(r, [op({ ...base, new: "Led 5 engineers through a migration.", origin: "ai_assisted" })], "Led a team of 5 engineers.");
    expect(firstRole(own.resume).item.bullets[0]).toMatchObject({ text: "Led a team of 5 engineers.", origin: "user" });
  });

  it("updates the summary only if unchanged", () => {
    const r = senior();
    const s = r.sections.find((x) => x.type === "summary")!;
    const item = s.items[0] as ItemOf<"summary">;
    const out = apply(r, [op({ op: "set_summary_text", section_id: s.id, item_id: item.id, old: item.text, new: "Tailored summary.", origin: "ai_assisted" })]);
    expect(out.resume.sections.find((x) => x.type === "summary")!.items[0]).toMatchObject({ text: "Tailored summary.", origin: "ai_assisted" });
  });
});

describe("general enhancement operations", () => {
  it("removes a bullet only if unchanged", () => {
    const r = senior();
    const role = firstRole(r);
    const bullet = role.item.bullets[1]!;
    const base = { op: "remove_bullet" as const, section_id: role.section.id, item_id: role.item.id, bullet_id: bullet.id };
    const out = apply(r, [op({ ...base, old: bullet.text })]);
    expect(firstRole(out.resume).item.bullets.map((b) => b.id)).not.toContain(bullet.id);
    expect(apply(r, [op({ ...base, old: "edited since" })]).stale).toHaveLength(1);
  });

  it("sets a deduplicated skills list only if unchanged", () => {
    const r = senior();
    const { section, group } = skillsGroup(r);
    const base = { op: "set_skills" as const, section_id: section.id, item_id: group.id, order: ["Go", "Java"] };
    expect(skillsGroup(apply(r, [op({ ...base, old: group.skills.join(", ") })]).resume).group.skills).toEqual(["Go", "Java"]);
    expect(apply(r, [op({ ...base, old: "different" })]).stale).toHaveLength(1);
  });
});

describe("diffWords", () => {
  it("marks added and removed words", () => {
    const parts = diffWords("Built the API in Go", "Built the payments API in Golang");
    expect(parts.filter((p) => p.type === "added").map((p) => p.text.trim())).toEqual(["payments", "Golang"]);
    expect(parts.filter((p) => p.type === "removed").map((p) => p.text.trim())).toEqual(["Go"]);
    expect(parts.map((p) => (p.type === "removed" ? "" : p.text)).join("")).toBe("Built the payments API in Golang");
  });
});

describe("JobStore", () => {
  it("saves, updates and lists jobs alongside resumes in one database", async () => {
    const resumes = new ResumeStore(new IDBFactory());
    const jobs = new JobStore(resumes.db);
    const r = senior();
    await resumes.save(r);
    const record = {
      id: "job1", title: "Backend Engineer", company: "Acme", url: null, text: "JD",
      analysis: { title: null, company: null, requirements: [], keywords: [], years_required: null, education_level: null,
        education_text: null, education_alternative: false, method: "rules" as const, text: "JD" },
      baseResumeId: r.id, tailoredResumeId: r.id, original: r, rejectedSuggestions: [], status: "saved" as const, notes: "",
    };
    await jobs.save(record);
    const updated = await jobs.update("job1", (j) => ({ ...j, rejectedSuggestions: ["s1"] }));
    expect(updated?.rejectedSuggestions).toEqual(["s1"]);
    expect(await jobs.update("missing", (j) => j)).toBeUndefined();
    expect((await jobs.list()).map((j) => j.id)).toEqual(["job1"]);
    expect(await resumes.list()).toHaveLength(1);
    await resumes.deleteAll();
    expect(await jobs.list()).toEqual([]);
  });
});
