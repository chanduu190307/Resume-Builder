import { Copy, DatabaseBackup, FilePlus2, FileUp, MoreHorizontal, Pencil, Target, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, IconButton } from "../components/ui/Button.tsx";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog.tsx";
import { getTemplate } from "../lib/document/templates.ts";
import { downloadBlob } from "../lib/download.ts";
import { createResume, duplicateResume } from "../lib/factories.ts";
import { BackupError, createBackup, parseBackup } from "../lib/storage/backup.ts";
import { getJobStore, getStore, getVersionStore, requestPersistentStorage, type StoredResume } from "../lib/storage/db.ts";

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 30) return rtf.format(-Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString();
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<StoredResume[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<StoredResume | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; message: string; details?: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setRecords(await getStore().list());
    } catch (err) {
      console.error(err);
      setError("Your browser blocked access to local storage, so resumes cannot be saved. Private browsing modes often do this.");
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const resume = createResume();
    await getStore().save(resume);
    void requestPersistentStorage();
    navigate(`/resumes/${resume.id}`);
  };

  const duplicate = async (record: StoredResume) => {
    await getStore().save(duplicateResume(record.resume, `Copy of ${record.resume.meta.title}`));
    await refresh();
  };

  const rename = async (record: StoredResume, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === record.resume.meta.title) return;
    await getStore().save({ ...record.resume, meta: { ...record.resume.meta, title: trimmed } });
    await refresh();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    await getStore().delete(toDelete.id);
    await getVersionStore().deleteForResume(toDelete.id);
    setToDelete(null);
    await refresh();
  };

  const deleteAll = async () => {
    await getStore().deleteAll();
    setDeleteAllOpen(false);
    setDataOpen(false);
    await refresh();
  };

  const downloadBackup = async () => {
    const [jobs, versions] = await Promise.all([getJobStore().list(), getVersionStore().listAll()]);
    const backup = createBackup((records ?? []).map((r) => r.resume), jobs, versions);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    downloadBlob(blob, `resume-builder-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const restore = async (file: File) => {
    try {
      const [jobs, versions] = await Promise.all([getJobStore().list(), getVersionStore().listAll()]);
      const restored = await parseBackup(await file.text(), {
        resumes: (records ?? []).map((r) => r.id),
        jobs: jobs.map((j) => j.id),
        versions: versions.map((v) => v.id),
      });
      for (const resume of restored.resumes) await getStore().save(resume);
      for (const job of restored.jobs) await getJobStore().save(job);
      for (const version of restored.versions) await getVersionStore().put(version);
      const n = restored.resumes.length;
      const extras = [
        restored.jobs.length ? `${restored.jobs.length} application${restored.jobs.length === 1 ? "" : "s"}` : "",
        restored.versions.length ? `${restored.versions.length} saved version${restored.versions.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      setRestoreResult({ ok: true, message: `Restored ${n} ${n === 1 ? "resume" : "resumes"}${extras.length ? ` and ${extras.join(" and ")}` : ""}.` });
      await refresh();
    } catch (err) {
      setRestoreResult({
        ok: false,
        message: err instanceof BackupError ? err.message : "The file could not be read.",
        details: err instanceof BackupError ? err.details : undefined,
      });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your resumes</h1>
          <p className="mt-1 text-sm text-ink-muted">Saved automatically in this browser.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<DatabaseBackup className="size-4" aria-hidden />} onClick={() => setDataOpen(true)}>
            Backup & data
          </Button>
          <Button icon={<FileUp className="size-4" aria-hidden />} onClick={() => navigate("/import")}>
            Import resume
          </Button>
          {records && records.length > 0 && (
            <Button icon={<Target className="size-4" aria-hidden />} onClick={() => navigate("/tailor")}>
              Tailor to a job
            </Button>
          )}
          <Button variant="primary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => void create()}>
            New resume
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {records && records.length === 0 && !error && (
        <div className="mt-10 rounded-card border border-dashed border-line-strong bg-surface/50 px-6 py-16 text-center">
          <div className="mx-auto mb-5 w-fit animate-float">
            <PaperThumb large />
          </div>
          <h2 className="text-base font-semibold">No resumes yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">
            Create your first resume. It is stored only on this device, and you can download a backup at any time.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button icon={<FileUp className="size-4" aria-hidden />} onClick={() => navigate("/import")}>
              Import an existing resume
            </Button>
            <Button variant="primary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => void create()}>
              Create a resume
            </Button>
          </div>
        </div>
      )}

      {records && records.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {records.map((record) => (
            <ResumeCard
              key={record.id}
              record={record}
              onRename={(title) => void rename(record, title)}
              onDuplicate={() => void duplicate(record)}
              onDelete={() => setToDelete(record)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete "${toDelete?.resume.meta.title ?? ""}"?`}
        description="This permanently removes the resume from this browser. This cannot be undone."
        confirmLabel="Delete resume"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />

      <Dialog
        open={dataOpen}
        onClose={() => {
          setDataOpen(false);
          setRestoreResult(null);
        }}
        title="Backup & data"
        description="There are no accounts: your resumes live only in this browser. Clearing browser data removes them, so keep a backup."
        footer={<Button onClick={() => setDataOpen(false)}>Close</Button>}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button icon={<DatabaseBackup className="size-4" aria-hidden />} disabled={!records?.length} onClick={() => void downloadBackup()}>
              Download backup
            </Button>
            <Button icon={<Upload className="size-4" aria-hidden />} onClick={() => fileInput.current?.click()}>
              Restore from backup
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void restore(file);
              }}
            />
          </div>
          {restoreResult && (
            <div role="status" className={`rounded-lg px-3 py-2 text-[13px] ${restoreResult.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
              {restoreResult.message}
              {restoreResult.details && restoreResult.details.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {restoreResult.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-2 border-t border-line pt-4">
            <h3 className="text-sm font-medium">Delete all my data</h3>
            <p className="mt-1 text-[13px] text-ink-muted">Permanently removes every resume stored by this app in this browser.</p>
            <Button className="mt-3" variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleteAllOpen(true)}>
              Delete all data
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteAllOpen}
        title="Delete all your data?"
        description={`This permanently deletes ${records?.length ?? 0} ${records?.length === 1 ? "resume" : "resumes"} from this browser. Download a backup first if you might need them.`}
        confirmLabel="Delete everything"
        danger
        onConfirm={() => void deleteAll()}
        onCancel={() => setDeleteAllOpen(false)}
      />
    </div>
  );
}

interface ResumeCardProps {
  record: StoredResume;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ResumeCard({ record, onRename, onDuplicate, onDelete }: ResumeCardProps) {
  const { resume } = record;
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(resume.meta.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const finishRename = () => {
    setRenaming(false);
    onRename(title);
  };

  return (
    <li className="group relative flex flex-col rounded-card border border-line bg-surface p-5 shadow-card transition-[transform,box-shadow] duration-300 ease-(--ease-out-soft) focus-within:z-10 hover:z-10 hover:-translate-y-1 hover:shadow-raised">
      <PaperThumb />
      {renaming ? (
        <input
          aria-label="Resume name"
          autoFocus
          className="rounded-md border border-accent px-2 py-1 text-[15px] font-semibold focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={finishRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") finishRename();
            if (e.key === "Escape") {
              setTitle(resume.meta.title);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <Link to={`/resumes/${resume.id}`} className="pr-8 text-[15px] font-semibold tracking-tight after:absolute after:inset-0 hover:text-accent">
          {resume.meta.title || "Untitled resume"}
        </Link>
      )}
      <p className="mt-1 truncate text-sm text-ink-muted">{resume.contact.full_name || "No name yet"}</p>
      <p className="mt-4 text-xs text-ink-faint">
        {getTemplate(resume.meta.template).name} · Edited {relativeTime(record.updatedAt)}
      </p>

      <div ref={menuRef} className="absolute top-3 right-3 z-[1]">
        <IconButton label="Resume actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          <MoreHorizontal className="size-4" aria-hidden />
        </IconButton>
        {menuOpen && (
          <div role="menu" className="absolute right-0 mt-1 w-40 rounded-lg border border-line bg-surface p-1 shadow-raised">
            {[
              { label: "Rename", icon: Pencil, action: () => setRenaming(true) },
              { label: "Duplicate", icon: Copy, action: onDuplicate },
              { label: "Delete", icon: Trash2, action: onDelete, danger: true },
            ].map(({ label, icon: Icon, action, danger }) => (
              <button
                key={label}
                role="menuitem"
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle ${danger ? "text-danger" : "text-ink"}`}
                onClick={() => {
                  setMenuOpen(false);
                  action();
                }}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** Small schematic page used as a visual anchor on resume cards. Decorative. */
function PaperThumb({ large }: { large?: boolean }) {
  return (
    <div
      aria-hidden
      className={`mb-4 flex flex-col gap-1 rounded-[4px] bg-white p-1.5 shadow-raised ring-1 ring-line transition-transform duration-300 ease-(--ease-spring) group-hover:-rotate-3 group-hover:scale-105 ${
        large ? "h-[68px] w-[52px] gap-1.5 p-2" : "h-[46px] w-[36px]"
      }`}
    >
      <span className="h-1 w-3/5 rounded-full bg-ink/70" />
      <span className="h-0.5 w-2/5 rounded-full bg-accent/60" />
      <span className="mt-0.5 h-0.5 w-full rounded-full bg-line-strong" />
      <span className="h-0.5 w-4/5 rounded-full bg-line-strong" />
      <span className="h-0.5 w-full rounded-full bg-line-strong" />
      {large && <span className="h-0.5 w-3/5 rounded-full bg-line-strong" />}
    </div>
  );
}
