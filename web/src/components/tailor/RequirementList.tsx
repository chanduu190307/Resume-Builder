import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import type { RequirementMatch } from "../../types/jobs.generated.ts";

const ICON: Record<RequirementMatch["status"], React.ReactNode> = {
  met: <CheckCircle2 className="size-4 text-success" aria-label="Met" />,
  partial: <MinusCircle className="size-4 text-warning" aria-label="Partly shown" />,
  not_met: <XCircle className="size-4 text-danger" aria-label="Not met" />,
  not_found: <CircleDashed className="size-4 text-ink-faint" aria-label="Not found" />,
};

const GROUPS: { kind: RequirementMatch["kind"]; title: string }[] = [
  { kind: "required", title: "Required" },
  { kind: "preferred", title: "Preferred" },
  { kind: "responsibility", title: "Responsibilities" },
];

export function RequirementList({ requirements }: { requirements: RequirementMatch[] }) {
  return (
    <section aria-label="Requirements" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-medium">Requirements checklist</h3>
      {GROUPS.map((g) => {
        const items = requirements.filter((r) => r.kind === g.kind);
        if (!items.length) return null;
        return (
          <div key={g.kind} className="mt-3">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{g.title}</p>
            <ul className="mt-1 divide-y divide-line">
              {items.map((r) => (
                <li key={r.requirement_id} className="flex gap-2.5 py-2 text-[13px]">
                  <span className="mt-0.5 shrink-0">{ICON[r.status]}</span>
                  <div className="min-w-0">
                    <p className="leading-relaxed">{r.text}</p>
                    <p className="mt-0.5 leading-relaxed text-ink-muted">{r.explanation}</p>
                    {r.evidence.slice(0, 1).map((e, i) => (
                      <p key={i} className="mt-1 border-l-2 border-line-strong pl-2 text-xs text-ink-muted">
                        {e.text}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
