import { SECTION_META, SECTION_TYPES } from "../../lib/factories.ts";
import type { SectionType } from "../../types/resume.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (type: SectionType) => void;
  existing: SectionType[];
}

export function AddSectionDialog({ open, onClose, onAdd, existing }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Add a section"
      description="You can rename, hide or reorder any section later. Sections can be added more than once (e.g. separate Experience and Internships)."
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {SECTION_TYPES.map((type) => {
          const meta = SECTION_META[type];
          const count = existing.filter((t) => t === type).length;
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => onAdd(type)}
                className="flex h-full w-full flex-col items-start gap-0.5 rounded-lg border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle"
              >
                <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                  {meta.label}
                  {count > 0 && <span className="text-xs font-normal text-ink-faint">{count} added</span>}
                </span>
                <span className="text-[13px] leading-snug text-ink-muted">{meta.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
