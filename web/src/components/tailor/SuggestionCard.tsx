import { Check, Info, Pencil, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { diffWords } from "../../lib/diff.ts";
import { prefersReducedMotion } from "../../lib/motion/motion.ts";
import type { Suggestion } from "../../types/jobs.generated.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox, TextArea } from "../ui/fields.tsx";
import { cn } from "../ui/cn.ts";

const INFO_ONLY = new Set<Suggestion["kind"]>(["gap", "summary_tip", "tip"]);
const TEXT_DIFF = new Set<Suggestion["kind"]>([
  "use_job_wording", "rewrite_bullet", "rewrite_summary", "remove_first_person", "fix_tense", "dedupe_skills",
]);
const LIST_DIFF = new Set<Suggestion["kind"]>(["reorder_bullets", "reorder_skills"]);

export function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="leading-relaxed">
      {diffWords(before, after).map((part, i) => (
        <span
          key={i}
          className={cn(
            part.type === "added" && "rounded-sm bg-success-soft text-success",
            part.type === "removed" && "rounded-sm bg-danger-soft text-danger line-through",
          )}
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}

interface Props {
  suggestion: Suggestion;
  onAccept: (text?: string) => void;
  onReject: () => void;
  /** Optional: jump to the place in the editor the suggestion refers to. */
  onGoTo?: (ref: NonNullable<Suggestion["ref"]>) => void;
}

/** Matches --animate-card-out-* in index.css. */
const CARD_EXIT_MS = 260;

const PROMPTS = new Set<Suggestion["kind"]>(["add_metric", "rewrite_weak"]);

export function SuggestionCard({ suggestion: s, onAccept, onReject, onGoTo }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(PROMPTS.has(s.kind));
  const [text, setText] = useState(s.after ?? s.before ?? "");
  const info = INFO_ONLY.has(s.kind);
  const ai = s.kind === "rewrite_bullet" || s.kind === "rewrite_summary";
  const changedByUser = PROMPTS.has(s.kind) ? text.trim() !== (s.before ?? "").trim() : true;
  const [leaving, setLeaving] = useState<"accept" | "reject" | null>(null);

  /** Let the card slide out, then run the action. If the card is still here afterwards
      (e.g. the suggestion was out of date), it simply comes back. */
  const leave = (direction: "accept" | "reject", action: () => void) => {
    if (leaving) return;
    if (prefersReducedMotion()) return action();
    setLeaving(direction);
    window.setTimeout(() => {
      action();
      setLeaving(null);
    }, CARD_EXIT_MS);
  };
  const accept = () => leave("accept", () => onAccept(editing ? text : undefined));
  const reject = () => leave("reject", onReject);

  return (
    <li
      className={cn(
        "rounded-card border border-line bg-surface p-4 shadow-card transition-shadow duration-300 hover:shadow-raised",
        leaving === "accept" && "animate-card-out-right pointer-events-none",
        leaving === "reject" && "animate-card-out-left pointer-events-none",
      )}
      aria-label={s.title}
    >
      <div className="flex items-start gap-2">
        {ai ? <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-label="AI-assisted" /> : info ? <Info className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{s.title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{s.reason}</p>
        </div>
      </div>

      {s.evidence.length > 0 && (
        <div className="mt-2 text-[13px]">
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">From your resume</p>
          {s.evidence.map((e, i) => (
            <p key={i} className="mt-0.5 border-l-2 border-line-strong pl-2 text-ink-muted">
              {e}
            </p>
          ))}
        </div>
      )}

      {!editing && TEXT_DIFF.has(s.kind) && s.before && s.after && (
        <div className="mt-2 rounded-lg bg-subtle p-2.5 text-[13px]">
          <Diff before={s.before} after={s.after} />
        </div>
      )}
      {LIST_DIFF.has(s.kind) && s.before && s.after && (
        <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
          <div className="rounded-lg bg-subtle p-2.5">
            <p className="text-[11px] font-semibold text-ink-faint uppercase">Now</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-ink-muted">
              {s.before.split("\n").map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </div>
          <div className="rounded-lg bg-success-soft/60 p-2.5">
            <p className="text-[11px] font-semibold text-success uppercase">Suggested</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              {s.after.split("\n").map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </div>
        </div>
      )}
      {s.kind === "remove_duplicate" && s.before && (
        <p className="mt-2 rounded-lg bg-danger-soft/60 p-2.5 text-[13px] text-danger line-through">{s.before}</p>
      )}

      {editing && (
        <div className="mt-2 flex flex-col gap-1.5">
          <TextArea aria-label="Edit suggestion" minRows={2} value={text} onValueChange={setText} />
          {s.kind === "add_metric" && (
            <p className="text-xs text-ink-faint">Add the real figure yourself. We never insert numbers for you.</p>
          )}
          {s.kind === "rewrite_weak" && (
            <p className="text-xs text-ink-faint">Rewrite it in your own words: start with a verb and say what changed because of you.</p>
          )}
        </div>
      )}

      {s.needs_confirmation && s.confirmation && (
        <div className="mt-3 rounded-lg bg-accent-soft/60 px-3 py-2">
          <Checkbox label={`Yes: ${s.confirmation.replace(/\?$/, "")}`} checked={confirmed} onCheckedChange={setConfirmed} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {info ? (
          <Button size="sm" variant="ghost" icon={<Check className="size-3.5" aria-hidden />} onClick={reject}>
            Got it
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={(s.needs_confirmation && !confirmed) || (editing && (!text.trim() || !changedByUser))}
              icon={<Check className="size-3.5" aria-hidden />}
              onClick={accept}
            >
              {PROMPTS.has(s.kind) ? "Save" : "Accept"}
            </Button>
            {s.editable && !editing && (
              <Button size="sm" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(true)}>
                Edit first
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" aria-hidden />} onClick={reject}>
              {PROMPTS.has(s.kind) ? "Skip" : "Reject"}
            </Button>
          </>
        )}
        {onGoTo && s.ref && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onGoTo(s.ref!)}>
            Show in resume
          </Button>
        )}
      </div>
    </li>
  );
}
