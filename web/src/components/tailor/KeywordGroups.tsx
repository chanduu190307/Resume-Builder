import { useState } from "react";
import type { KeywordMatch } from "../../types/jobs.generated.ts";
import { cn } from "../ui/cn.ts";

const GROUPS: { status: KeywordMatch["status"]; title: string; help: string; chip: string }[] = [
  { status: "present", title: "Already shown", help: "In your roles or projects, in the job's wording.", chip: "bg-success-soft text-success" },
  { status: "equivalent", title: "Shown, in other words", help: "Same skill, written differently.", chip: "bg-success-soft text-success" },
  { status: "weak", title: "Weakly shown", help: "Listed, but not shown in any role.", chip: "bg-warning-soft text-warning" },
  { status: "supported", title: "Possibly supported", help: "Implied by a related skill you list. Add only if true.", chip: "bg-accent-soft text-accent" },
  { status: "missing", title: "Not in your resume", help: "No evidence found.", chip: "bg-subtle text-ink-muted" },
];

export function KeywordGroups({ keywords }: { keywords: KeywordMatch[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = keywords.find((k) => k.skill === open);
  return (
    <section aria-label="Keywords" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-medium">Keywords from the job</h3>
      <p className="mt-0.5 text-xs text-ink-muted">Matched by meaning, not just exact words. Select a keyword to see why.</p>
      <div className="mt-3 flex flex-col gap-3">
        {GROUPS.map((g) => {
          const items = keywords.filter((k) => k.status === g.status);
          if (!items.length) return null;
          return (
            <div key={g.status}>
              <p className="text-[13px] font-medium">
                {g.title} <span className="font-normal text-ink-faint">({items.length}) · {g.help}</span>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {items.map((k) => (
                  <li key={k.skill}>
                    <button
                      type="button"
                      aria-expanded={open === k.skill}
                      onClick={() => setOpen(open === k.skill ? null : k.skill)}
                      className={cn("rounded-md px-2 py-1 text-[13px] ring-accent/40 hover:ring-2", g.chip, open === k.skill && "ring-2")}
                    >
                      {k.term}
                      {k.importance !== "mentioned" && (
                        <span className="ml-1 text-[10px] font-semibold tracking-wide uppercase">
                          {k.importance === "required" ? "req" : "pref"}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {active && (
        <div className="mt-3 rounded-lg bg-subtle p-3 text-[13px]" role="status">
          <p className="font-medium">
            {active.term} <span className="font-normal text-ink-muted">({active.importance} by the job)</span>
          </p>
          <p className="mt-1 leading-relaxed text-ink-muted">{active.explanation}</p>
          {active.evidence.length > 0 && (
            <ul className="mt-2 space-y-1">
              {active.evidence.map((e, i) => (
                <li key={i} className="border-l-2 border-line-strong pl-2 text-ink">
                  <span className="text-[11px] text-ink-faint uppercase">{e.where}</span> {e.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
