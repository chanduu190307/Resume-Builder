/**
 * Import an existing resume (PDF / DOCX / TXT upload or pasted text), review
 * what was extracted, then save it as a new resume. Nothing is saved until the
 * user confirms on the review screen.
 */
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, FileUp, Info, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router";
import { itemSummary } from "../components/editor/ItemFields.tsx";
import { PdfPreview } from "../components/preview/PdfPreview.tsx";
import { Button } from "../components/ui/Button.tsx";
import { cn } from "../components/ui/cn.ts";
import { describeImportError, importResumeFile, importResumeText, type ImportResponse } from "../lib/api.ts";
import { SECTION_META } from "../lib/factories.ts";
import { formatRange } from "../lib/format/dates.ts";
import { getStore, requestPersistentStorage } from "../lib/storage/db.ts";
import type { ItemOf, Resume, Section, SectionType } from "../types/resume.ts";

const UNSORTED_TITLE = "Imported text to review";
const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

type Stage =
  | { kind: "input" }
  | { kind: "processing"; label: string }
  | { kind: "review"; result: ImportResponse; label: string };

export function ImportPage() {
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, task: () => Promise<ImportResponse>) => {
    setError(null);
    setStage({ kind: "processing", label });
    try {
      const result = await task();
      setStage({ kind: "review", result, label });
    } catch (err) {
      setError(describeImportError(err));
      setStage({ kind: "input" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-8 sm:px-6 sm:py-10">
      <Link to="/resumes" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Your resumes
      </Link>
      {stage.kind === "review" ? (
        <ReviewStep result={stage.result} label={stage.label} onRestart={() => setStage({ kind: "input" })} />
      ) : (
        <InputStep
          busy={stage.kind === "processing" ? stage.label : null}
          error={error}
          onFile={(file) => void run(file.name, () => importResumeFile(file))}
          onText={(text) => void run("Pasted text", () => importResumeText(text))}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- input

function InputStep({
  busy,
  error,
  onFile,
  onText,
}: {
  busy: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onText: (text: string) => void;
}) {
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Import your resume</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        We read your resume and organise it into editable sections. Your text is kept exactly as written, and you can
        review everything before it is saved. The file is processed and not stored.
      </p>

      <div className="mt-6 flex gap-1 rounded-lg bg-subtle p-1" role="tablist" aria-label="Import method">
        {(
          [
            ["file", "Upload a file", FileUp],
            ["paste", "Paste text", ClipboardPaste],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium",
              tab === key ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {busy ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-16 text-center shadow-card" role="status">
          <Loader2 className="size-6 animate-spin text-ink-muted" aria-hidden />
          <p className="text-sm font-medium">Reading {busy}…</p>
          <p className="text-xs text-ink-faint">This usually takes a few seconds.</p>
        </div>
      ) : tab === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "group mt-4 flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-[background-color,border-color,box-shadow,transform] duration-300 ease-(--ease-out-soft)",
            dragging ? "scale-[1.01] border-accent bg-accent-soft shadow-glow" : "border-line-strong bg-surface hover:border-accent/40",
          )}
        >
          <span
            className={cn(
              "grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent transition-transform duration-300 ease-(--ease-spring)",
              dragging ? "-translate-y-1 scale-110" : "group-hover:-translate-y-0.5",
            )}
          >
            <UploadCloud className="size-7" aria-hidden />
          </span>
          <p className="text-sm font-medium">Drag and drop your resume here</p>
          <p className="text-xs text-ink-faint">PDF, Word (.docx) or text (.txt), up to 5 MB</p>
          <Button variant="primary" onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label="Resume file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <label htmlFor="paste-area" className="text-[13px] font-medium text-ink-muted">
            Resume text
          </label>
          <textarea
            id="paste-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="Paste the full text of your resume here…"
            className="w-full rounded-card border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-ink-faint focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
          />
          <Button variant="primary" className="self-end" disabled={!text.trim()} onClick={() => onText(text)}>
            Import text
          </Button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- review

/** Key fields per item type; an item missing one is highlighted for review. */
function itemGaps(type: SectionType, item: ItemOf<SectionType>): string[] {
  const gaps: string[] = [];
  if (type === "experience") {
    const it = item as ItemOf<"experience">;
    if (!it.title) gaps.push("job title");
    if (!it.organization) gaps.push("company");
    if (!it.start && !it.end && !it.current) gaps.push("dates");
  } else if (type === "education") {
    const it = item as ItemOf<"education">;
    if (!it.institution) gaps.push("school");
  } else if (type === "projects" && !(item as ItemOf<"projects">).name) {
    gaps.push("name");
  }
  return gaps;
}

function itemDates(type: SectionType, item: ItemOf<SectionType>): string {
  if (type === "experience" || type === "education" || type === "projects") {
    const it = item as ItemOf<"experience">;
    return formatRange(it.start, it.end, it.current);
  }
  return "";
}

function ReviewStep({ result, label, onRestart }: { result: ImportResponse; label: string; onRestart: () => void }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const resume = result.resume;
  const c = resume.contact;
  const sections = resume.sections.filter((s) => s.title !== UNSORTED_TITLE);

  const save = async () => {
    setSaving(true);
    const name = c.full_name.trim();
    const toSave: Resume = { ...resume, meta: { ...resume.meta, title: name ? `${name} (imported)` : label.replace(/\.[^.]+$/, "") } };
    await getStore().save(toSave);
    void requestPersistentStorage();
    navigate(`/resumes/${toSave.id}`);
  };

  const contactRows: [string, string | null][] = [
    ["Name", c.full_name || null],
    ["Title", c.headline],
    ["Email", c.email],
    ["Phone", c.phone],
    ["Location", c.location],
    ["Links", c.links.map((l) => l.url).join(", ") || null],
  ];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Check your imported resume</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            From <span className="font-medium text-ink">{label}</span>: {sections.length} sections found. Fix anything highlighted after
            you continue; nothing has been saved yet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRestart}>Import something else</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()} icon={saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}>
            Continue to editor
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {result.method !== "rules" && (
            <Notice tone="info" icon={<Sparkles className="size-4" aria-hidden />}>
              AI helped organise this resume. Every value was checked against your document, and anything not found in it was discarded.
            </Notice>
          )}
          {result.unplaced.length > 0 && (
            <Notice tone="warning" icon={<AlertTriangle className="size-4" aria-hidden />}>
              <p className="font-medium">
                {result.unplaced.length} {result.unplaced.length === 1 ? "line" : "lines"} could not be placed automatically
              </p>
              <p className="mt-0.5">They are kept in a hidden section called “{UNSORTED_TITLE}” so nothing is lost. Move them where they belong in the editor.</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px]">
                {result.unplaced.slice(0, 8).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
                {result.unplaced.length > 8 && <li>…and {result.unplaced.length - 8} more</li>}
              </ul>
            </Notice>
          )}
          {result.warnings
            .filter((w) => !w.includes("could not be placed"))
            .map((w) => (
              <Notice key={w} tone="warning" icon={<AlertTriangle className="size-4" aria-hidden />}>
                {w}
              </Notice>
            ))}
          {result.notes.map((n) => (
            <Notice key={n} tone="info" icon={<Info className="size-4" aria-hidden />}>
              {n}
            </Notice>
          ))}

          <section aria-label="Contact details found" className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">Contact details</h2>
            <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {contactRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className={cn("truncate", !v && "text-warning")}>{v ?? "Not found"}</dd>
                </div>
              ))}
            </dl>
          </section>

          {sections.map((section) => (
            <ReviewSection key={section.id} section={section} />
          ))}

          <details className="rounded-card border border-line bg-surface p-4 shadow-card">
            <summary className="cursor-pointer text-sm font-medium">Show the text we read from your file</summary>
            <p className="mt-2 text-xs text-ink-muted">This is the plain text a resume parser sees. If something is missing here, it is missing for applicant tracking systems too.</p>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-subtle p-3 text-xs leading-relaxed whitespace-pre-wrap">{result.extracted_text}</pre>
          </details>
        </div>

        <aside aria-label="Preview" className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <PdfPreview resume={resume} />
        </aside>
      </div>
    </div>
  );
}

function ReviewSection({ section }: { section: Section }) {
  const items = section.items as ItemOf<SectionType>[];
  return (
    <section aria-label={section.title} className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{section.title}</h2>
        <span className="text-xs text-ink-faint">
          {SECTION_META[section.type].label} · {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {items.map((item) => {
          const gaps = itemGaps(section.type, item);
          const dates = itemDates(section.type, item);
          const bullets = "bullets" in item ? item.bullets.length : 0;
          return (
            <li key={item.id} className="py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{itemSummary(section.type, item) || <span className="text-ink-faint">(empty)</span>}</span>
                {dates && <span className="shrink-0 text-xs text-ink-muted">{dates}</span>}
              </div>
              {(bullets > 0 || gaps.length > 0) && (
                <p className="mt-0.5 text-xs">
                  {bullets > 0 && <span className="text-ink-faint">{bullets} bullet{bullets === 1 ? "" : "s"}</span>}
                  {gaps.length > 0 && <span className="ml-2 text-warning">Check: {gaps.join(", ")} not found</span>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Notice({ tone, icon, children }: { tone: "info" | "warning"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
