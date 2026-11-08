/**
 * Resume analysis: Quality Score, Parsing Readiness Score, checks and the text
 * an ATS would read. Every number is explained; "Go to" jumps to the field.
 */
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Info, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { analyzeResume, describeImportError, type CareerLevel } from "../../lib/api.ts";
import { useDebounced } from "../../lib/useDebounced.ts";
import type { AnalysisResult, Category, Criterion, Issue, Ref, Score } from "../../types/analysis.generated.ts";
import type { Resume } from "../../types/resume.ts";
import { MeterBar, ScoreRing } from "../motion/ScoreRing.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";

const ANALYSIS_DEBOUNCE_MS = 1500;

/** Scrolls the editor to the field a finding refers to and highlights it briefly. */
export function focusRef(ref: Ref): boolean {
  const selector = ref.bullet_id
    ? `[data-bullet-id="${ref.bullet_id}"]`
    : ref.item_id
      ? `[data-item-id="${ref.item_id}"]`
      : ref.section_id
        ? `[data-section-id="${ref.section_id}"]`
        : ref.field
          ? `[data-field="${ref.field}"]`
          : null;
  const el = selector ? document.querySelector<HTMLElement>(selector) : null;
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (el.matches("input, textarea, select")) el.focus({ preventScroll: true });
  el.classList.add("ring-2", "ring-accent", "ring-offset-2");
  setTimeout(() => el.classList.remove("ring-2", "ring-accent", "ring-offset-2"), 1800);
  return true;
}

interface Props {
  resume: Resume;
  onGoTo: (ref: Ref) => void;
}

export function AnalysisPanel({ resume, onGoTo }: Props) {
  const debounced = useDebounced(resume, ANALYSIS_DEBOUNCE_MS);
  const [level, setLevel] = useState<CareerLevel>("auto");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    (async () => {
      try {
        const { renderPdfBlob } = await import("../../lib/render/exporters.tsx");
        const pdf = await renderPdfBlob(debounced).catch(() => null);
        const analysis = await analyzeResume(debounced, pdf, level, controller.signal);
        setResult(analysis);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) setError(describeImportError(err).replace("imported", "analysed"));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [debounced, level, nonce]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <label className="flex items-center gap-2">
          Scored for
          <select
            aria-label="Career stage"
            className="h-7 cursor-pointer rounded-md border border-line bg-surface px-2 text-xs text-ink"
            value={level}
            onChange={(e) => setLevel(e.target.value as CareerLevel)}
          >
            <option value="auto">Detect automatically</option>
            <option value="early">Early career</option>
            <option value="experienced">Experienced</option>
          </select>
        </label>
        <span className="inline-flex items-center gap-2">
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Analysing
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => setNonce((n) => n + 1)}>
              Re-run
            </Button>
          )}
        </span>
      </div>

      {error && (
        <p role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {!result && !error && (
        <div className="grid place-items-center rounded-card border border-line bg-surface py-16 text-sm text-ink-muted" role="status">
          <Loader2 className="mb-2 size-5 animate-spin" aria-hidden /> Analysing your resume…
        </div>
      )}

      {result && (
        <>
          <p className="text-xs text-ink-muted">{result.career_level_reason}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScoreCard title="Resume Quality" score={result.quality} help="Content and writing, judged against a fixed rubric." />
            <ScoreCard title="Parsing Readiness" score={result.parsing} help="How reliably applicant tracking systems can read it." />
          </div>
          <Breakdown title="Resume Quality breakdown" score={result.quality} onGoTo={onGoTo} />
          <Breakdown title="Parsing Readiness breakdown" score={result.parsing} onGoTo={onGoTo} />
          <IssueList issues={result.issues} onGoTo={onGoTo} />
          {result.ats_text && (
            <details className="rounded-card border border-line bg-surface p-4 shadow-card">
              <summary className="cursor-pointer text-sm font-medium">What an ATS sees</summary>
              <p className="mt-2 text-xs text-ink-muted">
                The plain text read back from your exported PDF, in the order a parser reads it. Anything missing or garbled here is missing for the ATS too.
              </p>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-subtle p-3 text-xs leading-relaxed whitespace-pre-wrap">{result.ats_text}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const BAND_COLOR: Record<Score["band"], string> = {
  Excellent: "text-success",
  Good: "text-success",
  Fair: "text-warning",
  "Needs work": "text-danger",
};

export function ScoreCard({ title, score, help }: { title: string; score: Score; help: string }) {
  return (
    <section
      aria-label={`${title} score`}
      data-score={score.total}
      className="rounded-card border border-line bg-surface p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
    >
      <div className="flex items-center gap-4">
        <ScoreRing value={score.total} caption="/ 100" size={76} stroke={7} />
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-ink-muted">{title}</h3>
          <p className={cn("mt-0.5 text-base font-semibold tracking-tight", BAND_COLOR[score.band])}>{score.band}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{help}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">{score.summary}</p>
    </section>
  );
}

const STATUS_ICON: Record<Criterion["status"], React.ReactNode> = {
  good: <CheckCircle2 className="size-4 text-success" aria-label="Good" />,
  fair: <AlertCircle className="size-4 text-warning" aria-label="Could be better" />,
  poor: <XCircle className="size-4 text-danger" aria-label="Needs work" />,
  not_measured: <CircleDashed className="size-4 text-ink-faint" aria-label="Not measured" />,
};

export function Breakdown({ title, score, onGoTo }: { title: string; score: Score; onGoTo: (ref: Ref) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="text-sm font-medium">{title}</span>
        <ChevronDown className={cn("size-4 text-ink-faint transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="flex animate-page-in flex-col gap-3 border-t border-line px-4 py-3">
          {score.categories.map((cat) => (
            <CategoryBlock key={cat.id} category={cat} onGoTo={onGoTo} />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryBlock({ category, onGoTo }: { category: Category; onGoTo: (ref: Ref) => void }) {
  const single = category.criteria.length === 1;
  return (
    <div>
      {!single && (
        <>
          <div className="flex items-baseline justify-between text-[13px] font-semibold">
            <span>{category.label}</span>
            <span className="tabular-nums text-ink-muted">
              {category.score} / {category.max_score}
            </span>
          </div>
          <MeterBar value={category.score} max={category.max_score} className="mt-1.5" />
        </>
      )}
      <ul className={cn("flex flex-col gap-2", !single && "mt-1.5")}>
        {category.criteria.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0">{STATUS_ICON[c.status]}</span>
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{c.label}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{c.status === "not_measured" ? "—" : `${c.points} / ${c.max_points}`}</span>
              </div>
              <p className="mt-0.5 leading-relaxed text-ink-muted">{c.explanation}</p>
              {c.tips.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink">
                  {c.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              {c.refs.length > 0 && c.status !== "good" && (
                <button type="button" className="mt-1 text-xs font-medium text-accent hover:text-accent-hover" onClick={() => onGoTo(c.refs[0]!)}>
                  Show me{c.refs.length > 1 ? ` (${c.refs.length} places)` : ""}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEVERITY: Record<Issue["severity"], { label: string; icon: React.ReactNode }> = {
  error: { label: "Fix", icon: <XCircle className="size-4 text-danger" aria-hidden /> },
  warning: { label: "Improve", icon: <AlertCircle className="size-4 text-warning" aria-hidden /> },
  info: { label: "Consider", icon: <Info className="size-4 text-ink-faint" aria-hidden /> },
};

function IssueList({ issues, onGoTo }: { issues: Issue[]; onGoTo: (ref: Ref) => void }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-card border border-line bg-surface p-4 text-sm text-success shadow-card">
        <CheckCircle2 className="size-4" aria-hidden /> No issues found.
      </p>
    );
  }
  return (
    <section aria-label="Issues" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-medium">
        Checks <span className="font-normal text-ink-faint">({issues.length})</span>
      </h3>
      <ul className="mt-2 divide-y divide-line">
        {issues.map((issue, i) => (
          <li key={`${issue.id}-${i}`} className="flex gap-2.5 py-2.5 text-[13px]">
            <span className="mt-0.5 shrink-0" title={SEVERITY[issue.severity].label}>
              {SEVERITY[issue.severity].icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="leading-relaxed">{issue.message}</p>
              {issue.suggestion && <p className="mt-0.5 leading-relaxed text-ink-muted">{issue.suggestion}</p>}
              <div className="mt-1 flex items-center gap-3">
                {issue.ref && (
                  <button type="button" className="text-xs font-medium text-accent hover:text-accent-hover" onClick={() => onGoTo(issue.ref!)}>
                    Go to
                  </button>
                )}
                {!issue.affects_score && <span className="text-[11px] text-ink-faint">Does not affect your score</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
