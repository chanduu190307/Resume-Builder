import { describe, expect, it } from "vitest";
import { createResume } from "../factories.ts";
import { COALESCE_MS, HISTORY_LIMIT, historyReducer, initHistory, type History } from "./history.ts";

// key = null means "no coalescing" (passing undefined would trigger the default).
const setName = (state: History, name: string, at: number, key: string | null = "contact.full_name") =>
  historyReducer(state, {
    type: "edit",
    action: { type: "contact/set", patch: { full_name: name } },
    coalesceKey: key ?? undefined,
    at,
  });

describe("history", () => {
  it("undoes and redoes", () => {
    let h = initHistory(createResume());
    h = setName(h, "A", 0, null);
    h = setName(h, "B", 10, null);
    expect(h.present.contact.full_name).toBe("B");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.contact.full_name).toBe("A");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.contact.full_name).toBe("");
    h = historyReducer(h, { type: "undo" }); // nothing left: no-op
    expect(h.present.contact.full_name).toBe("");
    h = historyReducer(h, { type: "redo" });
    h = historyReducer(h, { type: "redo" });
    expect(h.present.contact.full_name).toBe("B");
  });

  it("coalesces rapid typing in one field into one undo step", () => {
    let h = initHistory(createResume());
    h = setName(h, "M", 0);
    h = setName(h, "Ma", 200);
    h = setName(h, "Mar", 400);
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.contact.full_name).toBe("");
  });

  it("starts a new step after a pause or a different field", () => {
    let h = initHistory(createResume());
    h = setName(h, "A", 0);
    h = setName(h, "AB", COALESCE_MS + 1);
    expect(h.past).toHaveLength(2);
    h = historyReducer(h, { type: "edit", action: { type: "contact/set", patch: { email: "x" } }, coalesceKey: "contact.email", at: COALESCE_MS + 2 });
    expect(h.past).toHaveLength(3);
  });

  it("a new edit clears the redo stack", () => {
    let h = initHistory(createResume());
    h = setName(h, "A", 0, null);
    h = historyReducer(h, { type: "undo" });
    h = setName(h, "B", 5000, null);
    expect(h.future).toEqual([]);
  });

  it("no-op edits do not create undo steps", () => {
    const h = initHistory(createResume());
    const same = historyReducer(h, { type: "edit", action: { type: "section/remove", id: "missing" } });
    expect(same).toBe(h);
  });

  it("caps history length", () => {
    let h = initHistory(createResume());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = setName(h, `n${i}`, i * 10_000, null);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
