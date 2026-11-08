import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Lightbulb, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SECTION_META } from "../../lib/factories.ts";
import type { ItemOf, Section, SectionType } from "../../types/resume.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { cn } from "../ui/cn.ts";
import { useEdit } from "./EditorContext.tsx";
import { ItemFields, itemSummary } from "./ItemFields.tsx";

/** True if the user has typed anything into the item (used to confirm deletes). */
function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => !["id", "kind", "origin", "type", "visible", "title"].includes(k) && hasContent(v));
  }
  return false;
}

interface SectionCardProps {
  section: Section;
  index: number;
  count: number;
}

export function SectionCard({ section, index, count }: SectionCardProps) {
  const edit = useEdit();
  const meta = SECTION_META[section.type];
  const [open, setOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const items = section.items as ItemOf<SectionType>[];

  const removeSection = () => {
    setConfirmDelete(false);
    edit({ type: "section/remove", id: section.id });
  };

  return (
    <section
      data-section-id={section.id}
      aria-label={section.title || meta.label}
      className={cn("rounded-card border border-line bg-surface shadow-card", !section.visible && "bg-surface/60")}
    >
      <header className="flex items-center gap-1 py-2 pr-2 pl-2">
        <IconButton label={open ? "Collapse section" : "Expand section"} onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden />
        </IconButton>
        <div className="flex min-w-0 flex-1 flex-col">
          <input
            aria-label="Section heading"
            className={cn(
              "w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-[15px] font-semibold tracking-tight text-ink hover:bg-subtle focus:bg-subtle focus:outline-none",
              !section.visible && "text-ink-faint",
            )}
            value={section.title}
            onChange={(e) =>
              edit({ type: "section/update", id: section.id, patch: { title: e.target.value } }, `section:${section.id}:title`)
            }
          />
          {/* Show the section type only when the heading no longer says it. */}
          {(section.title.trim() !== meta.defaultTitle || !section.visible) && (
            <span className="px-1.5 text-xs text-ink-faint">
              {[section.title.trim() !== meta.defaultTitle && meta.label, !section.visible && "hidden from resume"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <IconButton
          label={section.visible ? "Hide section from resume" : "Show section on resume"}
          onClick={() => edit({ type: "section/update", id: section.id, patch: { visible: !section.visible } })}
        >
          {section.visible ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
        </IconButton>
        <IconButton label="Move section up" disabled={index === 0} onClick={() => edit({ type: "section/move", id: section.id, dir: -1 })}>
          <ArrowUp className="size-4" aria-hidden />
        </IconButton>
        <IconButton label="Move section down" disabled={index === count - 1} onClick={() => edit({ type: "section/move", id: section.id, dir: 1 })}>
          <ArrowDown className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          label="Delete section"
          tone="danger"
          onClick={() => (hasContent(section.items) ? setConfirmDelete(true) : removeSection())}
        >
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </header>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 pt-3 pb-4 sm:px-4">
          <p className="flex gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px] leading-relaxed text-ink-muted">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
            {meta.guidance}
          </p>

          {items.map((item, i) => (
            <ItemCard key={item.id} section={section} item={item} index={i} count={items.length} />
          ))}

          <div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => edit({ type: "item/add", sectionId: section.id })}
            >
              Add {meta.itemNoun}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${section.title || meta.label}"?`}
        description="This section and everything in it will be removed. You can undo this with Ctrl+Z."
        confirmLabel="Delete section"
        danger
        onConfirm={removeSection}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}

interface ItemCardProps {
  section: Section;
  item: ItemOf<SectionType>;
  index: number;
  count: number;
}

function ItemCard({ section, item, index, count }: ItemCardProps) {
  const edit = useEdit();
  const [open, setOpen] = useState(true);
  const meta = SECTION_META[section.type];
  const summary = itemSummary(section.type, item) || `New ${meta.itemNoun}`;
  // Single-item sections like the summary do not need item chrome.
  const showChrome = section.type !== "summary" || count > 1;

  if (!showChrome) {
    return (
      <div data-item-id={item.id} className="rounded-lg">
        <ItemFields type={section.type} sectionId={section.id} item={item} />
      </div>
    );
  }

  return (
    <div data-item-id={item.id} className="rounded-lg border border-line">
      <div className="flex items-center gap-1 py-1 pr-1 pl-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-subtle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <ChevronDown className={cn("size-3.5 shrink-0 text-ink-faint transition-transform", !open && "-rotate-90")} aria-hidden />
          <span className={cn("truncate text-sm font-medium", !itemSummary(section.type, item) && "text-ink-faint")}>{summary}</span>
        </button>
        <IconButton label={`Move ${meta.itemNoun} up`} disabled={index === 0} onClick={() => edit({ type: "item/move", sectionId: section.id, itemId: item.id, dir: -1 })}>
          <ArrowUp className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton label={`Move ${meta.itemNoun} down`} disabled={index === count - 1} onClick={() => edit({ type: "item/move", sectionId: section.id, itemId: item.id, dir: 1 })}>
          <ArrowDown className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton label={`Delete ${meta.itemNoun}`} tone="danger" onClick={() => edit({ type: "item/remove", sectionId: section.id, itemId: item.id })}>
          <Trash2 className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      {open && (
        <div className="border-t border-line p-3">
          <ItemFields type={section.type} sectionId={section.id} item={item} />
        </div>
      )}
    </div>
  );
}
