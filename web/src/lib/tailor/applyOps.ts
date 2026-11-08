/**
 * Turns the engine's suggestion edit operations into editor actions.
 *
 * Safety: an operation is applied only if the resume still contains exactly
 * what the suggestion was based on (`old`). If the user has changed that text
 * since, the suggestion is reported as out of date instead of overwriting.
 */
import type { ResumeAction } from "../editor/reducer.ts";
import type { EditOp } from "../../types/jobs.generated.ts";
import type { ItemOf, Resume, SectionType } from "../../types/resume.ts";

export interface ApplyPlan {
  actions: ResumeAction[];
  /** Human-readable reasons for operations that could not be applied. */
  stale: string[];
}

function findItem(resume: Resume, sectionId: string | null, itemId: string | null) {
  const section = resume.sections.find((s) => s.id === sectionId);
  const item = section?.items.find((i) => i.id === itemId) as ItemOf<SectionType> | undefined;
  return { section, item };
}

/**
 * @param overrideText  replacement text the user typed (for editable suggestions)
 */
export function planOps(resume: Resume, ops: EditOp[], overrideText?: string): ApplyPlan {
  const actions: ResumeAction[] = [];
  const stale: string[] = [];

  for (const op of ops) {
    const { section, item } = findItem(resume, op.section_id, op.item_id);
    switch (op.op) {
      case "replace_skill": {
        const group = item as ItemOf<"skills"> | undefined;
        if (section?.type !== "skills" || !group || !op.old || !group.skills.includes(op.old)) {
          stale.push(`“${op.old}” is no longer in your skills.`);
          break;
        }
        const next = group.skills.map((s) => (s === op.old ? (op.new ?? s) : s));
        actions.push({ type: "item/update", sectionId: section.id, itemId: group.id, patch: { skills: next } });
        break;
      }
      case "add_skill": {
        if (!op.new) break;
        if (op.section_id && !(section?.type === "skills" && item)) {
          // The target group was removed; fall back to the first skills group, or a new section.
          const first = resume.sections.find((s) => s.type === "skills" && s.items.length);
          actions.push({ type: "skills/add", sectionId: first?.id ?? null, itemId: first?.items[0]?.id ?? null, skill: op.new });
        } else {
          actions.push({ type: "skills/add", sectionId: op.section_id, itemId: op.item_id, skill: op.new });
        }
        break;
      }
      case "reorder_skills": {
        const group = item as ItemOf<"skills"> | undefined;
        const same = group && [...group.skills].sort().join("\u0000") === [...op.order].sort().join("\u0000");
        if (section?.type !== "skills" || !group || !same) {
          stale.push("Your skills changed since this suggestion was made.");
          break;
        }
        actions.push({ type: "item/update", sectionId: section.id, itemId: group.id, patch: { skills: op.order } });
        break;
      }
      case "reorder_bullets": {
        const bullets = item && "bullets" in item ? item.bullets.map((b) => b.id) : null;
        if (!section || !item || !bullets || [...bullets].sort().join() !== [...op.order].sort().join()) {
          stale.push("The bullets in this role changed since this suggestion was made.");
          break;
        }
        actions.push({ type: "bullet/reorder", sectionId: section.id, itemId: item.id, order: op.order });
        break;
      }
      case "set_bullet_text": {
        const bullet = item && "bullets" in item ? item.bullets.find((b) => b.id === op.bullet_id) : undefined;
        const text = (overrideText ?? op.new ?? "").trim();
        if (!section || !item || !bullet || (op.old != null && bullet.text !== op.old)) {
          stale.push("That bullet was edited since this suggestion was made.");
          break;
        }
        if (!text) break;
        // Text the user typed themselves stays "user"; accepted AI wording is marked "ai_assisted".
        const origin = overrideText !== undefined && overrideText.trim() !== (op.new ?? "").trim() ? "user" : op.origin;
        actions.push({ type: "bullet/update", sectionId: section.id, itemId: item.id, bulletId: bullet.id, text, origin });
        break;
      }
      case "remove_bullet": {
        const bullet = item && "bullets" in item ? item.bullets.find((b) => b.id === op.bullet_id) : undefined;
        if (!section || !item || !bullet || (op.old != null && bullet.text !== op.old)) {
          stale.push("That bullet was edited since this suggestion was made.");
          break;
        }
        actions.push({ type: "bullet/remove", sectionId: section.id, itemId: item.id, bulletId: bullet.id });
        break;
      }
      case "set_skills": {
        const group = item as ItemOf<"skills"> | undefined;
        if (section?.type !== "skills" || !group || (op.old != null && group.skills.join(", ") !== op.old)) {
          stale.push("Your skills changed since this suggestion was made.");
          break;
        }
        actions.push({ type: "item/update", sectionId: section.id, itemId: group.id, patch: { skills: op.order } });
        break;
      }
      case "set_summary_text": {
        const summary = item as ItemOf<"summary"> | undefined;
        const text = (overrideText ?? op.new ?? "").trim();
        if (section?.type !== "summary" || !summary || (op.old != null && summary.text !== op.old)) {
          stale.push("Your summary was edited since this suggestion was made.");
          break;
        }
        if (!text) break;
        const origin = overrideText !== undefined && overrideText.trim() !== (op.new ?? "").trim() ? "user" : op.origin;
        actions.push({ type: "item/update", sectionId: section.id, itemId: summary.id, patch: { text, origin } });
        break;
      }
    }
  }
  return { actions, stale };
}
