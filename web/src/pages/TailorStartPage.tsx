/**
 * Start tailoring: pick a resume and provide a job description (paste or link).
 * Tailoring always works on a copy, so the original resume is never changed.
 */
import { AlertTriangle, ArrowLeft, ClipboardPaste, Link2, Loader2, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button.tsx";
import { Field, Select, TextInput } from "../components/ui/fields.tsx";
import { cn } from "../components/ui/cn.ts";
import { analyzeJob, describeError, fetchJobFromUrl } from "../lib/api.ts";
import { duplicateResume } from "../lib/factories.ts";
import { newId } from "../lib/ids.ts";
import { getJobStore, getStore, type StoredResume } from "../lib/storage/db.ts";

export function TailorStartPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [resumes, setResumes] = useState<StoredResume[] | null>(null);
  const [resumeId, setResumeId] = useState("");
  const [tab, setTab] = useState<"paste" | "link">("paste");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState<"fetch" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedNote, setFetchedNote] = useState<string | null>(null);

  useEffect(() => {
    void getStore()
      .list()
      .then((list) => {
        setResumes(list);
        const wanted = params.get("resume");
        setResumeId(list.find((r) => r.id === wanted)?.id ?? list[0]?.id ?? "");
      });
  }, [params]);

  const importLink = async () => {
    setBusy("fetch");
    setError(null);
    try {
      const job = await fetchJobFromUrl(url.trim());
      setText(job.text);
      if (job.title) setTitle(job.title);
      if (job.company) setCompany(job.company);
      setFetchedNote("Imported. Check the text below and remove anything that is not part of the job description.");
      setTab("paste");
    } catch (err) {
      setError(describeError(err, "That page could not be imported. Paste the job text instead."));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const base = resumes?.find((r) => r.id === resumeId);
    if (!base || !text.trim()) return;
    setBusy("analyze");
    setError(null);
    try {
      const analysis = await analyzeJob(text, title.trim() || null, company.trim() || null);
      const jobTitle = title.trim() || analysis.title || "Job";
      const jobCompany = company.trim() || analysis.company || "";
      const label = [jobTitle, jobCompany].filter(Boolean).join(" at ");
      const tailored = duplicateResume(base.resume, `${base.resume.meta.title} — ${label}`.slice(0, 280));
      await getStore().save(tailored);
      const id = newId();
      await getJobStore().save({
        id,
        title: jobTitle,
        company: jobCompany,
        url: url.trim() || null,
        text,
        analysis,
        baseResumeId: base.id,
        tailoredResumeId: tailored.id,
        original: base.resume,
        rejectedSuggestions: [],
        status: "saved",
        notes: "",
      });
      navigate(`/tailor/${id}`);
    } catch (err) {
      setError(describeError(err, "The job description could not be analysed."));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/resumes" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Your resumes
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Tailor your resume to a job</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        We compare your resume with the job description, show what matches and what is missing, and suggest truthful
        improvements. You work on a copy; your original resume stays as it is.
      </p>

      {resumes && resumes.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="text-sm text-ink-muted">You need a resume first.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => navigate("/import")}>Import a resume</Button>
            <Button variant="primary" onClick={() => navigate("/resumes")}>
              Create a resume
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <section className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">1. Choose a resume</h2>
            <Field label="Resume" className="mt-3">
              {(id) => (
                <Select
                  id={id}
                  value={resumeId}
                  onValueChange={setResumeId}
                  options={(resumes ?? []).map((r) => ({
                    value: r.id,
                    label: `${r.resume.meta.title}${r.resume.contact.full_name ? ` (${r.resume.contact.full_name})` : ""}`,
                  }))}
                />
              )}
            </Field>
          </section>

          <section className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">2. Add the job description</h2>
            <div className="mt-3 flex gap-1 rounded-lg bg-subtle p-1" role="tablist" aria-label="Job description source">
              {(
                [
                  ["paste", "Paste text", ClipboardPaste],
                  ["link", "Import from a link", Link2],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-[13px] font-medium",
                    tab === key ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>

            {tab === "link" ? (
              <div className="mt-4 flex flex-col gap-2">
                <Field label="Job posting link" hint="Works for many company career pages. Some job boards block automated access; paste the text if so.">
                  {(id) => (
                    <div className="flex gap-2">
                      <TextInput id={id} type="url" placeholder="https://…" value={url} onValueChange={setUrl} />
                      <Button disabled={!url.trim() || busy !== null} onClick={() => void importLink()}
                        icon={busy === "fetch" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : undefined}>
                        Import
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {fetchedNote && <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">{fetchedNote}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Job title (optional)">{(id) => <TextInput id={id} value={title} onValueChange={setTitle} />}</Field>
                  <Field label="Company (optional)">{(id) => <TextInput id={id} value={company} onValueChange={setCompany} />}</Field>
                </div>
                <label htmlFor="jd-text" className="text-[13px] font-medium text-ink-muted">
                  Job description
                </label>
                <textarea
                  id="jd-text"
                  rows={12}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the full job description, including requirements and responsibilities…"
                  className="w-full rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed placeholder:text-ink-faint focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
                />
              </div>
            )}
          </section>

          {error && (
            <p role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
            </p>
          )}

          <Button
            variant="primary"
            className="self-end"
            disabled={!resumeId || !text.trim() || busy !== null}
            onClick={() => void start()}
            icon={busy === "analyze" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Target className="size-4" aria-hidden />}
          >
            Compare and tailor
          </Button>
        </div>
      )}
    </div>
  );
}
