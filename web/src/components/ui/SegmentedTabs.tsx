import type { CSSProperties } from "react";
import { cn } from "./cn.ts";

interface Props<T extends string> {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}

/**
 * Equal-width tabs with a pill that slides to the selected tab. Arrow keys move between tabs.
 * Reduced motion makes the pill jump instead of slide (global CSS rule).
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, className }: Props<T>) {
  const index = Math.max(0, tabs.findIndex((t) => t.id === value));
  const pill: CSSProperties = {
    width: `calc((100% - 0.5rem) / ${tabs.length})`,
    transform: `translateX(${index * 100}%)`,
  };
  const move = (delta: number): number => {
    const nextIndex = (index + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (next) onChange(next.id);
    return nextIndex;
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("relative flex rounded-xl bg-subtle/80 p-1 ring-1 ring-line/60", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const nextIndex = move(e.key === "ArrowRight" ? 1 : -1);
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
      }}
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-lg bg-surface shadow-card ring-1 ring-line/70 transition-transform duration-300 ease-(--ease-out-soft)"
        style={pill}
      />
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative z-10 flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-colors",
              selected ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
