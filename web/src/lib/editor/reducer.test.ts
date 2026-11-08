import { describe, expect, it } from "vitest";
import { createResume } from "../factories.ts";
import type { ItemOf, Resume } from "../../types/resume.ts";
import { validateResume } from "../../test/fixtures.ts";
import { move, resumeReducer, type ResumeAction } from "./reducer.ts";

const apply = (resume: Resume, ...actions: ResumeAction[]) => actions.reduce(resumeReducer, resume);

function experience(resume: Resume) {
  const section = resume.sections.find((s) => s.type === "experience");
  if (!section || section.type !== "experience") throw new Error("no experience section");
  return section;
}

describe("move", () => {
  it("swaps neighbours and ignores out-of-range moves", () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    const list = [1, 2, 3];
    expect(move(list, 0, -1)).toBe(list);
    expect(move(list, 2, 1)).toBe(list);
    expect(move(list, -1, 1)).toBe(list);
  });
});

describe("resumeReducer", () => {
  it("never mutates the input and always produces a schema-valid resume", () => {
    const start = createResume();
    const frozen = structuredClone(start);
    const exp = experience(start);
    const item = exp.items[0]!;
    const result = apply(
      start,
      { type: "contact/set", patch: { full_name: "Test Person", email: "t@example.com" } },
      { type: "link/add" },
      { type: "section/add", sectionType: "projects" },
      { type: "section/add", sectionType: "custom", title: "Volunteering" },
      { type: "item/add", sectionId: exp.id },
      { type: "item/update", sectionId: exp.id, itemId: item.id, patch: { title: "Engineer", start: { year: 2020, month: 3 } } },
      { type: "bullet/add", sectionId: exp.id, itemId: item.id },
      { type: "meta/set", patch: { template: "modern", page_size: "Letter" } },
    );
    expect(start).toEqual(frozen);
    expect(validateResume(result), JSON.stringify(validateResume.errors)).toBe(true);
    expect(result.sections.map((s) => s.title)).toEqual([
      "Summary", "Experience", "Education", "Skills", "Projects", "Volunteering",
    ]);
  });

  it("reorders sections", () => {
    const start = createResume();
    const [first, second] = start.sections;
    const moved = apply(start, { type: "section/move", id: second!.id, dir: -1 });
    expect(moved.sections[0]!.id).toBe(second!.id);
    expect(moved.sections[1]!.id).toBe(first!.id);
  });

  it("renames, hides and removes sections", () => {
    const start = createResume();
    const id = experience(start).id;
    const renamed = apply(start, { type: "section/update", id, patch: { title: "Internships", visible: false } });
    expect(experience(renamed)).toMatchObject({ title: "Internships", visible: false });
    const removed = apply(renamed, { type: "section/remove", id });
    expect(removed.sections.some((s) => s.id === id)).toBe(false);
  });

  it("marking an item current clears its end date", () => {
    const start = createResume();
    const exp = experience(start);
    const itemId = exp.items[0]!.id;
    const result = apply(
      start,
      { type: "item/update", sectionId: exp.id, itemId, patch: { end: { year: 2024, month: null } } },
      { type: "item/update", sectionId: exp.id, itemId, patch: { current: true } },
    );
    const item = experience(result).items[0] as ItemOf<"experience">;
    expect(item.current).toBe(true);
    expect(item.end).toBeNull();
    expect(validateResume(result)).toBe(true);
  });

  it("item patches cannot change id or bullets", () => {
    const start = createResume();
    const exp = experience(start);
    const item = exp.items[0]!;
    const result = apply(start, {
      type: "item/update", sectionId: exp.id, itemId: item.id, patch: { id: "hacked", bullets: [], title: "X" },
    });
    const updated = experience(result).items[0]!;
    expect(updated.id).toBe(item.id);
    expect(updated.bullets).toEqual(item.bullets);
    expect(updated.title).toBe("X");
  });

  it("adds bullets after a given bullet, edits, reorders and removes them", () => {
    const start = createResume();
    const exp = experience(start);
    const item = exp.items[0]!;
    const firstId = item.bullets[0]!.id;
    let r = apply(start,
      { type: "bullet/update", sectionId: exp.id, itemId: item.id, bulletId: firstId, text: "first" },
      { type: "bullet/add", sectionId: exp.id, itemId: item.id },
    );
    const lastId = experience(r).items[0]!.bullets[1]!.id;
    r = apply(r,
      { type: "bullet/update", sectionId: exp.id, itemId: item.id, bulletId: lastId, text: "last" },
      { type: "bullet/add", sectionId: exp.id, itemId: item.id, afterId: firstId },
    );
    const middleId = experience(r).items[0]!.bullets[1]!.id;
    r = apply(r, { type: "bullet/update", sectionId: exp.id, itemId: item.id, bulletId: middleId, text: "middle" });
    expect(experience(r).items[0]!.bullets.map((b) => b.text)).toEqual(["first", "middle", "last"]);

    r = apply(r, { type: "bullet/move", sectionId: exp.id, itemId: item.id, bulletId: lastId, dir: -1 });
    expect(experience(r).items[0]!.bullets.map((b) => b.text)).toEqual(["first", "last", "middle"]);

    r = apply(r, { type: "bullet/remove", sectionId: exp.id, itemId: item.id, bulletId: firstId });
    expect(experience(r).items[0]!.bullets.map((b) => b.text)).toEqual(["last", "middle"]);
    expect(experience(r).items[0]!.bullets.every((b) => b.origin === "user")).toBe(true);
  });

  it("reorders and removes items", () => {
    const start = createResume();
    const exp = experience(start);
    let r = apply(start, { type: "item/add", sectionId: exp.id });
    const [a, b] = experience(r).items;
    r = apply(r, { type: "item/move", sectionId: exp.id, itemId: b!.id, dir: -1 });
    expect(experience(r).items.map((i) => i.id)).toEqual([b!.id, a!.id]);
    r = apply(r, { type: "item/remove", sectionId: exp.id, itemId: b!.id });
    expect(experience(r).items.map((i) => i.id)).toEqual([a!.id]);
  });

  it("unknown ids are a no-op and return the same object", () => {
    const start = createResume();
    expect(resumeReducer(start, { type: "section/update", id: "nope", patch: { title: "x" } })).toBe(start);
    expect(resumeReducer(start, { type: "item/remove", sectionId: "nope", itemId: "x" })).toBe(start);
  });

  it("manages contact links", () => {
    let r = apply(createResume(), { type: "link/add" });
    const id = r.contact.links[0]!.id;
    r = apply(r, { type: "link/update", id, patch: { url: "github.com/x", kind: "github" } });
    expect(r.contact.links[0]).toMatchObject({ url: "github.com/x", kind: "github" });
    r = apply(r, { type: "link/remove", id });
    expect(r.contact.links).toEqual([]);
  });
});
