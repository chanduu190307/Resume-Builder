/** Original vs tailored resume: every change, with a way to revert it. */
import { RotateCcw, Sparkles } from "lucide-react";
import type { Edit } from "../editor/EditorContext.tsx";
import type { ItemOf, Resume } from "../../types/resume.ts";
import { Button } from "../ui/Button.tsx";
import { Diff } from "./SuggestionCard.tsx";

interface Change {
  key: string;
  label: string;
  before: string;
  after: string;
  ai: boolean;
  revert?: () => void;
}

export function computeChanges(original: Resume, current: Resume, edit: Edit): Change[] {
  const changes: Change[] = [];
  for (const section of current.sections) {
    const before = original.sections.find((s) => s.id === section.id);
    if (!before) {
      changes.push({ key: section.id, label: `Added section “${section.title}”`, before: "", after: section.title, ai: false });
      continue;
    }
    for (const item of section.items as ItemOf<typeof section.type>[]) {
      const old = (before.items as ItemOf<typeof section.type>[]).find((i) => i.id === item.id);
      if (!old) continue;
      if (section.type === "summary") {
        const a = old as ItemOf<"summary">;
        const b = item as ItemOf<"summary">;
        if (a.text !== b.text) {
          changes.push({
            key: b.id, label: "Summary", before: a.text, after: b.text, ai: b.origin === "ai_assisted",
            revert: () => edit({ type: "item/update", sectionId: section.id, itemId: b.id, patch: { text: a.text, origin: a.origin } }),
          });
        }
      }
      if (section.type === "skills") {
        const a = old as ItemOf<"skills">;
        const b = item as ItemOf<"skills">;
        if (a.skills.join(", ") !== b.skills.join(", ")) {
          changes.push({
            key: b.id, label: `Skills${b.name ? `: ${b.name}` : ""}`, before: a.skills.join(", "), after: b.skills.join(", "), ai: false,
            revert: () => edit({ type: "item/update", sectionId: section.id, itemId: b.id, patch: { skills: a.skills } }),
          });
        }
      }
      if ("bullets" in item && "bullets" in old) {
        const label = "title" in item && item.title ? item.title : "name" in item ? (item as ItemOf<"projects">).name : section.title;
        for (const bullet of item.bullets) {
          const prev = old.bullets.find((x) => x.id === bullet.id);
          if (prev && prev.text !== bullet.text) {
            changes.push({
              key: bullet.id, label, before: prev.text, after: bullet.text, ai: bullet.origin === "ai_assisted",
              revert: () => edit({ type: "bullet/update", sectionId: section.id, itemId: item.id, bulletId: bullet.id, text: prev.text, origin: prev.origin }),
            });
          }
        }
        const oldOrder = old.bullets.map((b) => b.id).filter((id) => item.bullets.some((b) => b.id === id));
        const newOrder = item.bullets.map((b) => b.id).filter((id) => old.bullets.some((b) => b.id === id));
        if (oldOrder.join() !== newOrder.join()) {
          changes.push({
            key: `${item.id}-order`, label: `${label}: bullet order`, before: "", after: "Bullets reordered", ai: false,
            revert: () => edit({ type: "bullet/reorder", sectionId: section.id, itemId: item.id, order: [...oldOrder, ...item.bullets.map((b) => b.id).filter((id) => !oldOrder.includes(id))] }),
          });
        }
      }
    }
  }
  return changes;
}

interface Props {
  original: Resume;
  current: Resume;
  edit: Edit;
  onResetAll: () => void;
}

export function ChangesView({ original, current, edit, onResetAll }: Props) {
  const changes = computeChanges(original, current, edit);
  return (
    <section aria-label="Changes" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} from your original resume.` : "No changes yet."}
        </p>
        {changes.length > 0 && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={onResetAll}>
            Restore original
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {changes.map((c) => (
          <li key={c.key} className="rounded-card border border-line bg-surface p-3 text-[13px] shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {c.label}
                {c.ai && <Sparkles className="ml-1.5 inline size-3.5 text-accent" aria-label="AI-assisted wording you accepted" />}
              </span>
              {c.revert && (
                <button type="button" className="text-xs font-medium text-accent hover:text-accent-hover" onClick={c.revert}>
                  Revert
                </button>
              )}
            </div>
            <div className="mt-1.5">{c.before ? <Diff before={c.before} after={c.after} /> : <p className="text-ink-muted">{c.after}</p>}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
