/**
 * Tailoring workspace: Job Match Score, keywords, requirements and truthful
 * suggestions for one job, applied to the tailored copy of a resume.
 */
import { AlertTriangle, ArrowLeft, CheckCheck, ExternalLink, FileText, Loader2, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Breakdown, ScoreCard } from "../components/analysis/AnalysisPanel.tsx";
import { PdfPreview } from "../components/preview/PdfPreview.tsx";
import { ChangesView } from "../components/tailor/ChangesView.tsx";
import { CoverLetterPanel } from "../components/tailor/CoverLetterPanel.tsx";
import { KeywordGroups } from "../components/tailor/KeywordGroups.tsx";
import { RequirementList } from "../components/tailor/RequirementList.tsx";
import { SuggestionCard } from "../components/tailor/SuggestionCard.tsx";
import { SegmentedTabs } from "../components/ui/SegmentedTabs.tsx";
import { Button, IconButton } from "../components/ui/Button.tsx";
import { describeError, getHealth, matchJob, rewriteForJob } from "../lib/api.ts";
import { resumeReducer } from "../lib/editor/reducer.ts";
import { useResumeEditor } from "../lib/editor/useResumeEditor.ts";
import { getJobStore, getStore, type JobRecord } from "../lib/storage/db.ts";
import { planOps } from "../lib/tailor/applyOps.ts";
import { useDebounced } from "../lib/useDebounced.ts";
import type { Rejected, Suggestion, TailorResponse } from "../types/jobs.generated.ts";
import type { Resume } from "../types/resume.ts";

/** Suggestions that only change wording/order of existing content or add skills already shown. */
const SAFE = new Set<Suggestion["kind"]>(["use_job_wording", "add_evidenced_skill", "reorder_skills", "reorder_bullets"]);

export function TailorPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<{ status: "loading" } | { status: "missing" } | { status: "ready"; job: JobRecord; resume: Resume }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const job = await getJobStore().get(id);
      const resume = job ? await getStore().get(job.tailoredResumeId) : undefined;
      if (!active) return;
      setState(job && resume ? { status: "ready", job, resume: resume.resume } : { status: "missing" });
    })().catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="grid place-items-center py-32 text-ink-muted">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Tailoring session not found</h1>
        <p className="mt-2 text-sm text-ink-muted">The job or its tailored resume may have been deleted.</p>
        <Link to="/tailor" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-hover">
          Start a new one
        </Link>
      </div>
    );
  }
  return <Workspace key={state.job.id} initialJob={state.job} initialResume={state.resume} />;
}

function Workspace({ initialJob, initialResume }: { initialJob: JobRecord; initialResume: Resume }) {
  const navigate = useNavigate();
  const editor = useResumeEditor(initialResume);
  const { resume, edit, undo, redo } = editor;
  const [job, setJob] = useState(initialJob);
  // The job analysis is fixed for a session; keep a stable reference so saving the job doesn't re-run matching.
  const [analysis] = useState(initialJob.analysis);
  const debounced = useDebounced(resume, 700);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<string[]>([]);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState("");
  const [ai, setAi] = useState<{ suggestions: Suggestion[]; rejected: Rejected[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"preview" | "job" | "changes" | "letter">("preview");

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
    setBusy(true);
    matchJob(debounced, analysis, controller.signal)
      .then((r) => {
        setResult(r);
        setError(null);
        // Remember the latest score for the application tracker.
        if (r.match.score.total !== job.lastScore) {
          void getJobStore()
            .update(job.id, (j) => ({ ...j, lastScore: r.match.score.total }))
            .then((j) => j && setJob(j));
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(describeError(err, "The match could not be calculated."));
      })
      .finally(() => !controller.signal.aborted && setBusy(false));
    return () => controller.abort();
  }, [debounced, analysis, job.id]);

  const suggestions = useMemo(() => {
    const all = [...(result?.suggestions ?? []), ...(ai?.suggestions ?? [])];
    const seen = new Set<string>();
    return all.filter((s) => {
      if (seen.has(s.id) || job.rejectedSuggestions.includes(s.id) || handled.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [result, ai, job.rejectedSuggestions, handled]);

  const markHandled = (ids: string[]) => setHandled((prev) => new Set([...prev, ...ids]));

  const apply = (s: Suggestion, text?: string, base: Resume = resume): Resume => {
    const plan = planOps(base, s.ops, text);
    let next = base;
    for (const action of plan.actions) {
      edit(action);
      next = resumeReducer(next, action);
    }
    if (plan.stale.length) setStale((prev) => [...prev, ...plan.stale]);
    markHandled([s.id]);
    return next;
  };

  const reject = (s: Suggestion) => {
    markHandled([s.id]);
    void getJobStore()
      .update(job.id, (j) => ({ ...j, rejectedSuggestions: [...new Set([...j.rejectedSuggestions, s.id])] }))
      .then((j) => j && setJob(j));
  };

  const acceptAllSafe = () => {
    let current = resume;
    for (const s of suggestions.filter((x) => SAFE.has(x.kind) && !x.needs_confirmation)) current = apply(s, undefined, current);
  };

  const askAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      setAi(await rewriteForJob(resume, analysis));
    } catch (err) {
      setAiError(describeError(err, "AI suggestions are not available right now."));
    } finally {
      setAiBusy(false);
    }
  };

  const restoreOriginal = () => {
    edit({ type: "resume/replace", resume: { ...job.original, id: resume.id, meta: resume.meta } });
    setHandled(new Set());
  };

  const safeCount = suggestions.filter((s) => SAFE.has(s.kind) && !s.needs_confirmation).length;
  const actionable = suggestions.filter((s) => s.kind !== "gap" && s.kind !== "summary_tip");
  const notes = suggestions.filter((s) => s.kind === "gap" || s.kind === "summary_tip");

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/resumes" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Your resumes
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">
            {job.title}
            {job.company && <span className="font-normal text-ink-muted"> at {job.company}</span>}
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tailoring a copy: <span className="text-ink">{resume.meta.title}</span>. Your original resume is unchanged.
            {job.url && (
              <a href={job.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-accent hover:text-accent-hover">
                Job posting <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="Undo (Ctrl+Z)" disabled={!editor.canUndo} onClick={undo}>
            <Undo2 className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Redo" disabled={!editor.canRedo} onClick={redo}>
            <Redo2 className="size-4" aria-hidden />
          </IconButton>
          <Button
            icon={<FileText className="size-4" aria-hidden />}
            onClick={() => void editor.flush().then(() => navigate(`/resumes/${resume.id}`))}
          >
            Open tailored resume
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {error && (
            <p role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
          {!result && !error && (
            <div className="grid place-items-center rounded-card border border-line bg-surface py-16 text-sm text-ink-muted" role="status">
              <Loader2 className="mb-2 size-5 animate-spin" aria-hidden /> Comparing your resume with the job…
            </div>
          )}

          {result && (
            <>
              <div className="relative">
                <ScoreCard title="Job Match" score={result.match.score} help="How closely this resume matches this job. Separate from resume quality." />
                {busy && <Loader2 className="absolute top-4 right-4 size-4 animate-spin text-ink-faint" aria-label="Updating" />}
              </div>
              <Breakdown title="Job Match breakdown" score={result.match.score} onGoTo={() => undefined} />

              <section aria-label="Suggestions" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold tracking-tight">
                    Suggestions <span className="font-normal text-ink-faint">({actionable.length})</span>
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {safeCount > 1 && (
                      <Button size="sm" icon={<CheckCheck className="size-3.5" aria-hidden />} onClick={acceptAllSafe}>
                        Accept {safeCount} wording &amp; order changes
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!aiAvailable || aiBusy}
                      title={aiAvailable ? "Suggest clearer, job-focused wording. Every suggestion is checked for invented facts." : aiStatus}
                      icon={aiBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                      onClick={() => void askAi()}
                    >
                      Suggest rewording with AI
                    </Button>
                  </div>
                </div>
                {aiAvailable === false && (
                  <p className="text-xs text-ink-faint">AI rewording is off: {aiStatus || "the engine has no AI key configured."} All other suggestions work without it.</p>
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
                    Some suggestions were out of date and were not applied: {[...new Set(stale)].join(" ")}
                  </p>
                )}
                {actionable.length === 0 ? (
                  <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
                    No more suggestions. Review the keywords and requirements below, or open the tailored resume to edit it directly.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {actionable.map((s) => (
                      <SuggestionCard key={s.id} suggestion={s} onAccept={(text) => apply(s, text)} onReject={() => reject(s)} />
                    ))}
                  </ul>
                )}
                {notes.length > 0 && (
                  <>
                    <h3 className="mt-2 text-sm font-semibold">Gaps and notes</h3>
                    <ul className="flex flex-col gap-3">
                      {notes.map((s) => (
                        <SuggestionCard key={s.id} suggestion={s} onAccept={() => undefined} onReject={() => reject(s)} />
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <KeywordGroups keywords={result.match.keywords} />
              <RequirementList requirements={result.match.requirements} />
            </>
          )}
        </div>

        <aside aria-label="Tailored resume" className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-6">
          <SegmentedTabs
            className="mb-3"
            label="Side panel"
            value={panel}
            onChange={setPanel}
            tabs={[
              { id: "preview", label: "Preview" },
              { id: "changes", label: "Changes" },
              { id: "letter", label: "Cover letter" },
              { id: "job", label: "Job" },
            ]}
          />
          {panel === "preview" && <PdfPreview resume={resume} />}
          {panel === "changes" && <ChangesView original={job.original} current={resume} edit={edit} onResetAll={restoreOriginal} />}
          {panel === "letter" && (
            <CoverLetterPanel
              resume={resume}
              analysis={analysis}
              initialText={job.coverLetter ?? ""}
              aiAvailable={Boolean(aiAvailable)}
              onSave={(text) => {
                void getJobStore()
                  .update(job.id, (j) => ({ ...j, coverLetter: text }))
                  .then((j) => j && setJob(j));
              }}
            />
          )}
          {panel === "job" && (
            <pre className="rounded-card border border-line bg-surface p-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap shadow-card">{job.text}</pre>
          )}
        </aside>
      </div>
    </div>
  );
}
