import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createResume } from "../factories.ts";
import { loadFixture, FIXTURE_FILES } from "../../test/fixtures.ts";
import { ResumeStore } from "./db.ts";

function clock(start = Date.parse("2026-01-01T00:00:00Z")) {
  let t = start;
  return () => new Date((t += 1000));
}

describe("ResumeStore", () => {
  it("round-trips every fixture losslessly", async () => {
    const store = new ResumeStore(new IDBFactory(), clock());
    for (const file of FIXTURE_FILES) {
      const resume = loadFixture(file);
      await store.save(resume);
      const loaded = await store.get(resume.id);
      expect(loaded?.resume).toEqual(resume);
    }
    expect(await store.list()).toHaveLength(FIXTURE_FILES.length);
  });

  it("lists most recently edited first and keeps createdAt on update", async () => {
    const store = new ResumeStore(new IDBFactory(), clock());
    const a = createResume("A");
    const b = createResume("B");
    const savedA = await store.save(a);
    await store.save(b);
    expect((await store.list()).map((r) => r.resume.meta.title)).toEqual(["B", "A"]);

    const updatedA = await store.save({ ...a, meta: { ...a.meta, title: "A2" } });
    expect(updatedA.createdAt).toBe(savedA.createdAt);
    expect(updatedA.updatedAt > savedA.updatedAt).toBe(true);
    expect((await store.list()).map((r) => r.resume.meta.title)).toEqual(["A2", "B"]);
  });

  it("deletes one resume", async () => {
    const store = new ResumeStore(new IDBFactory(), clock());
    const a = createResume("A");
    const b = createResume("B");
    await store.save(a);
    await store.save(b);
    await store.delete(a.id);
    expect(await store.get(a.id)).toBeUndefined();
    expect((await store.list()).map((r) => r.id)).toEqual([b.id]);
  });

  it("deleteAll removes everything and the store keeps working afterwards", async () => {
    const factory = new IDBFactory();
    const store = new ResumeStore(factory, clock());
    await store.save(createResume("A"));
    await store.deleteAll();
    expect(await store.list()).toEqual([]);
    await store.save(createResume("B"));
    expect(await store.list()).toHaveLength(1);
  });
});

describe("VersionStore", () => {
  it("lists versions newest first and prunes only automatic restore points", async () => {
    const { VersionStore, MAX_AUTO_VERSIONS } = await import("./db.ts");
    const store = new ResumeStore(new IDBFactory(), clock());
    let n = 0;
    const versions = new VersionStore(store.db, clock(), () => `v${n++}`);
    const r = createResume("A");
    await versions.save(r, "Named", false);
    for (let i = 0; i < MAX_AUTO_VERSIONS + 5; i++) await versions.save(r, `Auto ${i}`, true);
    const list = await versions.list(r.id);
    expect(list.filter((v) => v.auto)).toHaveLength(MAX_AUTO_VERSIONS);
    expect(list.some((v) => v.label === "Named")).toBe(true);
    expect(list[0]!.label).toBe(`Auto ${MAX_AUTO_VERSIONS + 4}`);
    await versions.deleteForResume(r.id);
    expect(await versions.list(r.id)).toEqual([]);
  });
});
