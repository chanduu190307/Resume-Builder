import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { cn } from "./cn.ts";

/** Splits pasted or typed text like "React, Node.js; SQL" into separate tags. */
export function splitTags(text: string): string[] {
  return text
    .split(/[,;\n•]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Adds tags, skipping case-insensitive duplicates. Never reorders existing tags. */
export function addTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const next = existing.slice();
  for (const tag of incoming) {
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      next.push(tag);
    }
  }
  return next;
}

interface TagInputProps {
  id?: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
}

export function TagInput({ id, value, onValueChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (text: string) => {
    const tags = splitTags(text);
    if (tags.length) onValueChange(addTags(value, tags));
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length) {
      e.preventDefault();
      setDraft(value[value.length - 1] ?? "");
      onValueChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 transition-colors",
        "hover:border-line-strong focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15",
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-md bg-subtle py-0.5 pr-1 pl-2 text-[13px] text-ink"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="grid size-4 place-items-center rounded text-ink-faint hover:bg-line hover:text-ink"
            onClick={() => onValueChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,;\n]/.test(text)) {
            e.preventDefault();
            commit(draft + text);
          }
        }}
      />
    </div>
  );
}
