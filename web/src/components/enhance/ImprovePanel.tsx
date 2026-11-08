/**
 * General improvements (no job description): safe fixes, prompts for real
 * numbers, tips, and optional AI wording that passes the truthfulness guard.
 */
import { AlertTriangle, CheckCheck, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError, enhanceResume, enhanceWithAi, getHealth } from "../../lib/api.ts";
import { resumeReducer } from "../../lib/editor/reducer.ts";
import { planOps } from "../../lib/tailor/applyOps.ts";
import { useDebounced } from "../../lib/useDebounced.ts";
import type { Ref } from "../../types/analysis.generated.ts";
import type { Rejected, Suggestion } from "../../types/jobs.generated.ts";
import type { Resume } from "../../types/resume.ts";
import type { Edit } from "../editor/EditorContext.tsx";
import { SuggestionCard } from "../tailor/SuggestionCard.tsx";
import { Button } from "../ui/Button.tsx";

const SAFE = new Set<Suggestion["kind"]>(["remove_first_person", "fix_tense", "remove_duplicate", "dedupe_skills"]);
const storageKey = (resumeId: string) => `rb:dismissed:${resumeId}`;

function loadDismissed(resumeId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey(resumeId)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

interface Props {
  resume: Resume;
  edit: Edit;
  onGoTo: (ref: Ref) => void;
}

export function ImprovePanel({ resume, edit, onGoTo }: Props) {
  const debounced = useDebounced(resume, 900);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => loadDismissed(resume.id));
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState<string[]>([]);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState("");
  const [ai, setAi] = useState<{ suggestions: Suggestion[]; rejected: Rejected[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => {
        setAiAvailable(h.ai_available);
        setAiStatus(h.ai_status);
      })
      .catch(() => setAiAvailable(false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    enhanceResume(debounced, controller.signal)
      .then((r) => {
        setSuggestions(r.suggestions);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(describeError(err, "Suggestions could not be loaded."));
      });
    return () => controller.abort();
  }, [debounced]);

  const visible = useMemo(() => {
    const all = [...(suggestions ?? []), ...(ai?.suggestions ?? [])];
    const seen = new Set<string>();
    return all.filter((s) => !dismissed.has(s.id) && !handled.has(s.id) && !seen.has(s.id) && seen.add(s.id));
  }, [suggestions, ai, dismissed, handled]);

  const apply = (s: Suggestion, text?: string, base: Resume = resume): Resume => {
    const plan = planOps(base, s.ops, text);
    let next = base;
    for (const action of plan.actions) {
      edit(action);
      next = resumeReducer(next, action);
    }
    if (plan.stale.length) setStale((prev) => [...prev, ...plan.stale]);
    setHandled((prev) => new Set([...prev, s.id]));
    return next;
  };

  const dismiss = (s: Suggestion) => {
    const next = new Set([...dismissed, s.id]);
    setDismissed(next);
    try {
      localStorage.setItem(storageKey(resume.id), JSON.stringify([...next]));
    } catch {
      /* storage full or blocked: dismissal lasts for this session only */
    }
  };

  const acceptSafe = () => {
    let current = resume;
    for (const s of visible.filter((x) => SAFE.has(x.kind))) current = apply(s, undefined, current);
  };

  const askAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      setAi(await enhanceWithAi(resume));
    } catch (err) {
      setAiError(describeError(err, "AI suggestions are not available right now."));
    } finally {
      setAiBusy(false);
    }
  };

  const actionable = visible.filter((s) => s.kind !== "tip");
  const tips = visible.filter((s) => s.kind === "tip");
  const safeCount = visible.filter((s) => SAFE.has(s.kind)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Improvements that keep your facts exactly as they are.</p>
        <div className="flex flex-wrap gap-2">
          {safeCount > 1 && (
            <Button size="sm" icon={<CheckCheck className="size-3.5" aria-hidden />} onClick={acceptSafe}>
              Apply {safeCount} safe fixes
            </Button>
          )}
          <Button
            size="sm"
            disabled={!aiAvailable || aiBusy}
            title={aiAvailable ? "Clarity, grammar and spelling. Every suggestion is checked for invented facts." : aiStatus}
            icon={aiBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
            onClick={() => void askAi()}
          >
            Improve wording with AI
          </Button>
        </div>
      </div>
      {aiAvailable === false && (
        <p className="text-xs text-ink-faint">AI wording, grammar and spelling are off: {aiStatus || "the engine has no AI key configured."}</p>
      )}
      {aiError && <p role="alert" className="text-sm text-danger">{aiError}</p>}
      {ai && ai.rejected.length > 0 && (
        <details className="rounded-lg bg-subtle px-3 py-2 text-[13px]">
          <summary className="cursor-pointer">
            {ai.rejected.length} AI suggestion{ai.rejected.length === 1 ? " was" : "s were"} discarded because they added facts not in your resume
          </summary>
          <ul className="mt-2 space-y-1.5">
            {ai.rejected.map((r, i) => (
              <li key={i}>
                <span className="text-ink-muted line-through">{r.text}</span>
                <span className="block text-xs text-danger">{r.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {stale.length > 0 && (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          Some suggestions were out of date and were not applied.
        </p>
      )}
      {error && (
        <p role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
      {!suggestions && !error && (
        <div className="grid place-items-center rounded-card border border-line bg-surface py-12 text-sm text-ink-muted" role="status">
          <Loader2 className="mb-2 size-5 animate-spin" aria-hidden /> Looking for improvements…
        </div>
      )}
      {suggestions && actionable.length === 0 && (
        <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">No suggestions right now.</p>
      )}
      <ul className="flex flex-col gap-3" aria-label="Improvement suggestions">
        {actionable.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} onAccept={(text) => apply(s, text)} onReject={() => dismiss(s)} onGoTo={onGoTo} />
        ))}
      </ul>
      {tips.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Tips">
          {tips.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onAccept={() => undefined} onReject={() => dismiss(s)} onGoTo={onGoTo} />
          ))}
        </ul>
      )}
    </div>
  );
}
