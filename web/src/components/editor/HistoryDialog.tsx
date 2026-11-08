/**
 * Version history for one resume. Restoring first saves the current state as
 * a restore point, so going back never loses work.
 */
import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getVersionStore, type ResumeVersion } from "../../lib/storage/db.ts";
import type { Resume } from "../../types/resume.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextInput } from "../ui/fields.tsx";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface Props {
  open: boolean;
  onClose: () => void;
  resume: Resume;
  onRestore: (version: Resume) => void;
}

export function HistoryDialog({ open, onClose, resume, onRestore }: Props) {
  const [versions, setVersions] = useState<ResumeVersion[] | null>(null);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => setVersions(await getVersionStore().list(resume.id)), [resume.id]);

  useEffect(() => {
    if (open) {
      setMessage(null);
      void refresh();
    }
  }, [open, refresh]);

  const saveNamed = async () => {
    await getVersionStore().save(resume, label.trim() || "Saved version", false);
    setLabel("");
    setMessage("Version saved.");
    await refresh();
  };

  const restore = async (version: ResumeVersion) => {
    await getVersionStore().save(resume, "Before restoring an earlier version", true);
    onRestore({ ...version.resume, id: resume.id });
    setMessage(`Restored “${version.label}”. Your previous state was saved as a restore point.`);
    await refresh();
  };

  const remove = async (version: ResumeVersion) => {
    await getVersionStore().delete(version.id);
    await refresh();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Version history"
      description="Restore points are saved automatically before each editing session and before every restore. Name a version to keep it permanently."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex gap-2">
        <TextInput aria-label="Version name" placeholder="e.g. Before tailoring for Acme" value={label} onValueChange={setLabel} />
        <Button icon={<Save className="size-4" aria-hidden />} onClick={() => void saveNamed()}>
          Save version
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">
          {message}
        </p>
      )}
      <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto" aria-label="Saved versions">
        {versions?.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">No versions yet.</li>}
        {versions?.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-2.5">
            <History className="size-4 shrink-0 text-ink-faint" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{v.label}</p>
              <p className="text-xs text-ink-muted">
                {when(v.createdAt)} · {v.auto ? "Automatic" : "Named"}
              </p>
            </div>
            <Button size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => void restore(v)}>
              Restore
            </Button>
            <IconButton label={`Delete version ${v.label}`} tone="danger" onClick={() => void remove(v)}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Save the resume as it was before this editing session, unless an identical restore point exists. */
export async function snapshotBeforeEditing(resume: Resume): Promise<void> {
  const store = getVersionStore();
  const [latest] = await store.list(resume.id);
  if (latest && JSON.stringify(latest.resume) === JSON.stringify(resume)) return;
  await store.save(resume, `Before editing on ${new Date().toLocaleDateString()}`, true);
}
