/** Application tracker: every job you tailored a resume for, with status, notes and links. */
import { Briefcase, ExternalLink, FileText, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, IconButton } from "../components/ui/Button.tsx";
import { Checkbox } from "../components/ui/fields.tsx";
import { Dialog } from "../components/ui/Dialog.tsx";
import { ScoreRing } from "../components/motion/ScoreRing.tsx";
import { cn } from "../components/ui/cn.ts";
import { getJobStore, getStore, getVersionStore, type ApplicationStatus, type JobRecord } from "../lib/storage/db.ts";

const STATUSES: { value: ApplicationStatus; label: string; tone: string }[] = [
  { value: "saved", label: "Saved", tone: "bg-subtle text-ink-muted" },
  { value: "applied", label: "Applied", tone: "bg-accent-soft text-accent" },
  { value: "interview", label: "Interviewing", tone: "bg-warning-soft text-warning" },
  { value: "offer", label: "Offer", tone: "bg-success-soft text-success" },
  { value: "rejected", label: "Not selected", tone: "bg-danger-soft text-danger" },
  { value: "withdrawn", label: "Withdrawn", tone: "bg-subtle text-ink-faint" },
];

export function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [resumeIds, setResumeIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ApplicationStatus | "all">("all");
  const [toDelete, setToDelete] = useState<JobRecord | null>(null);
  const [alsoResume, setAlsoResume] = useState(false);

  const refresh = useCallback(async () => {
    const [list, resumes] = await Promise.all([getJobStore().list(), getStore().list()]);
    setJobs(list);
    setResumeIds(new Set(resumes.map((r) => r.id)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = async (job: JobRecord, change: Partial<JobRecord>) => {
    const next = await getJobStore().update(job.id, (j) => ({ ...j, ...change }));
    if (next) setJobs((list) => list?.map((j) => (j.id === next.id ? next : j)) ?? null);
  };

  const setStatus = (job: JobRecord, status: ApplicationStatus) =>
    void update(job, { status, appliedAt: status === "applied" && !job.appliedAt ? new Date().toISOString() : job.appliedAt ?? null });

  const confirmDelete = async () => {
    if (!toDelete) return;
    await getJobStore().delete(toDelete.id);
    if (alsoResume) {
      await getStore().delete(toDelete.tailoredResumeId);
      await getVersionStore().deleteForResume(toDelete.tailoredResumeId);
    }
    setToDelete(null);
    setAlsoResume(false);
    await refresh();
  };

  const shown = (jobs ?? []).filter((j) => filter === "all" || j.status === filter);
  const count = (s: ApplicationStatus) => (jobs ?? []).filter((j) => j.status === s).length;

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your applications</h1>
          <p className="mt-1 text-sm text-ink-muted">Every job you tailored a resume for, with its own resume version.</p>
        </div>
        <Button variant="primary" icon={<Target className="size-4" aria-hidden />} onClick={() => navigate("/tailor")}>
          Tailor for a new job
        </Button>
      </div>

      {jobs && jobs.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {[{ value: "all" as const, label: `All (${jobs.length})` }, ...STATUSES.map((s) => ({ value: s.value, label: `${s.label} (${count(s.value)})` }))].map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px]",
                filter === f.value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {jobs && jobs.length === 0 && (
        <div className="mt-10 rounded-card border border-dashed border-line-strong bg-surface/50 px-6 py-16 text-center">
          <div className="mx-auto grid size-12 animate-float place-items-center rounded-2xl bg-surface text-accent shadow-raised ring-1 ring-line">
            <Briefcase className="size-5" aria-hidden />
          </div>
          <h2 className="mt-3 text-base font-semibold">No applications yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">
            Tailor a resume to a job description and it will appear here, so you can track where you applied.
          </p>
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {shown.map((job) => {
          const resumeExists = resumeIds.has(job.tailoredResumeId);
          return (
            <li key={job.id} className="rounded-card border border-line bg-surface p-4 shadow-card transition-shadow duration-300 hover:shadow-raised" aria-label={`${job.title}${job.company ? ` at ${job.company}` : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {typeof job.lastScore === "number" && <ScoreRing value={job.lastScore} size={44} stroke={4} />}
                  <div className="min-w-0">
                  <p className="text-[15px] font-semibold tracking-tight">
                    {job.title}
                    {job.company && <span className="font-normal text-ink-muted"> at {job.company}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Added {new Date(job.createdAt).toLocaleDateString()}
                    {job.appliedAt && ` · Applied ${new Date(job.appliedAt).toLocaleDateString()}`}
                    {typeof job.lastScore === "number" && ` · Job Match ${job.lastScore}/100`}
                  </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Application status"
                    value={job.status}
                    onChange={(e) => setStatus(job, e.target.value as ApplicationStatus)}
                    className={cn("h-8 cursor-pointer rounded-lg border border-line px-2 text-[13px] font-medium", STATUSES.find((s) => s.value === job.status)?.tone)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <IconButton label="Delete application" tone="danger" onClick={() => setToDelete(job)}>
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={<Target className="size-3.5" aria-hidden />} disabled={!resumeExists} onClick={() => navigate(`/tailor/${job.id}`)}>
                  Open tailoring
                </Button>
                {resumeExists ? (
                  <Button size="sm" icon={<FileText className="size-3.5" aria-hidden />} onClick={() => navigate(`/resumes/${job.tailoredResumeId}`)}>
                    Tailored resume
                  </Button>
                ) : (
                  <span className="self-center text-xs text-ink-faint">The tailored resume was deleted.</span>
                )}
                {job.url && (
                  <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 px-2 text-[13px] text-accent hover:text-accent-hover">
                    Job posting <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] text-ink-muted">Notes{job.notes ? " (1)" : ""}</summary>
                <textarea
                  aria-label="Notes"
                  defaultValue={job.notes}
                  rows={3}
                  placeholder="Contacts, interview dates, follow-ups…"
                  onBlur={(e) => e.target.value !== job.notes && void update(job, { notes: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-line bg-surface p-2.5 text-[13px] focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
                />
              </details>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete this application?"
        description="The job, its notes and tailoring progress will be removed from this browser."
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <Checkbox label="Also delete the tailored resume" checked={alsoResume} onCheckedChange={setAlsoResume} />
      </Dialog>
      <p className="mt-8 text-center text-xs text-ink-faint">
        Your original resumes are never changed by tailoring. <Link to="/resumes" className="text-accent underline underline-offset-2 hover:text-accent-hover">See all resumes</Link>
      </p>
    </div>
  );
}
