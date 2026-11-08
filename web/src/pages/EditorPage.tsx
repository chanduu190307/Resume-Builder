import { AlertCircle, ArrowLeft, Check, Download, FileText, History, Loader2, Plus, Redo2, Target, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { AddSectionDialog } from "../components/editor/AddSectionDialog.tsx";
import { ContactEditor } from "../components/editor/ContactEditor.tsx";
import { HistoryDialog, snapshotBeforeEditing } from "../components/editor/HistoryDialog.tsx";
import { EditContext } from "../components/editor/EditorContext.tsx";
import { SectionCard } from "../components/editor/SectionCard.tsx";
import { AnalysisPanel, focusRef } from "../components/analysis/AnalysisPanel.tsx";
import { ImprovePanel } from "../components/enhance/ImprovePanel.tsx";
import { PdfPreview } from "../components/preview/PdfPreview.tsx";
import { SegmentedTabs } from "../components/ui/SegmentedTabs.tsx";
import { Button, IconButton } from "../components/ui/Button.tsx";
import { Select } from "../components/ui/fields.tsx";
import { cn } from "../components/ui/cn.ts";
import { TEMPLATE_LIST, type TemplateId } from "../lib/document/templates.ts";
import { downloadBlob, resumeFilename } from "../lib/download.ts";
import { useResumeEditor, type SaveStatus } from "../lib/editor/useResumeEditor.ts";
import { getStore } from "../lib/storage/db.ts";
import type { Ref } from "../types/analysis.generated.ts";
import type { Resume } from "../types/resume.ts";

export function EditorPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<{ status: "loading" } | { status: "missing" } | { status: "ready"; resume: Resume }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getStore()
      .get(id)
      .then((record) => active && setState(record ? { status: "ready", resume: record.resume } : { status: "missing" }))
      .catch((err: unknown) => {
        console.error(err);
        if (active) setState({ status: "missing" });
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="grid place-items-center py-32 text-ink-muted">
        <Loader2 className="size-5 animate-spin" aria-label="Loading resume" />
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Resume not found</h1>
        <p className="mt-2 text-sm text-ink-muted">It may have been deleted, or it was created in another browser.</p>
        <Link to="/resumes" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-hover">
          Back to your resumes
        </Link>
      </div>
    );
  }
  return <Editor key={state.resume.id} initial={state.resume} />;
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: React.ReactNode; text: string; className?: string }> = {
    saved: { icon: <Check className="size-3.5" aria-hidden />, text: "Saved" },
    pending: { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, text: "Saving" },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, text: "Saving" },
    error: { icon: <AlertCircle className="size-3.5" aria-hidden />, text: "Not saved", className: "text-danger" },
  };
  const { icon, text, className } = map[status];
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)}>
      {icon}
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}

function Editor({ initial }: { initial: Resume }) {
  const editor = useResumeEditor(initial);
  const { resume, undo, redo } = editor;
  const [historyOpen, setHistoryOpen] = useState(false);
  const snapshotTaken = useRef(false);

  // The first edit of a session saves a restore point of the resume as it was.
  const edit = useCallback<typeof editor.edit>(
    (action, key) => {
      if (!snapshotTaken.current) {
        snapshotTaken.current = true;
        void snapshotBeforeEditing(initial).catch((err: unknown) => console.warn("restore point not saved", err));
      }
      editor.edit(action, key);
    },
    [editor, initial],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview" | "analysis" | "improve">("edit");
  const [sideTab, setSideTab] = useState<"preview" | "analysis" | "improve">("preview");

  const goTo = (ref: Ref) => {
    setMobileTab("edit");
    // Wait for the editor column to be visible (mobile) before scrolling.
    requestAnimationFrame(() => requestAnimationFrame(() => focusRef(ref)));
  };
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y operate on the whole resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo]);

  const download = async (kind: "pdf" | "docx") => {
    setExporting(kind);
    setExportError(null);
    try {
      const { renderPdfBlob, renderResumeDocx } = await import("../lib/render/exporters.tsx");
      const blob = kind === "pdf" ? await renderPdfBlob(resume) : await renderResumeDocx(resume);
      downloadBlob(blob, resumeFilename(resume.contact.full_name, kind));
    } catch (err) {
      console.error("export failed", err);
      setExportError(`The ${kind.toUpperCase()} could not be created. Please try again.`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <EditContext.Provider value={edit}>
      <div className="glass sticky top-14 z-[5] border-b border-line/70">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-3 py-2 sm:px-6">
          {/* Unmounting the editor flushes any pending save. */}
          <Link
            to="/resumes"
            aria-label="Back to your resumes"
            title="Back to your resumes"
            className="-ml-1 inline-grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-subtle hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <input
            aria-label="Resume name"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-subtle focus:bg-subtle focus:outline-none sm:max-w-xs"
            value={resume.meta.title}
            onChange={(e) => edit({ type: "meta/set", patch: { title: e.target.value } }, "meta:title")}
          />
          <SaveIndicator status={editor.saveStatus} />
          <Link
            to={`/tailor?resume=${resume.id}`}
            onClick={() => void editor.flush()}
            aria-label="Tailor to a job"
            title="Tailor to a job"
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-muted hover:bg-subtle hover:text-ink"
          >
            <Target className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Tailor to a job</span>
          </Link>
          <IconButton label="Version history" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Undo (Ctrl+Z)" disabled={!editor.canUndo} onClick={undo}>
            <Undo2 className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!editor.canRedo} onClick={redo}>
            <Redo2 className="size-4" aria-hidden />
          </IconButton>
          {/* On phones the export controls wrap onto their own row. */}
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <Select
              aria-label="Template"
              className="h-8 min-w-0 flex-1 text-[13px] sm:w-[7rem] sm:flex-none"
              value={resume.meta.template as TemplateId}
              onValueChange={(template) => edit({ type: "meta/set", patch: { template } })}
              options={TEMPLATE_LIST.map((t) => ({ value: t.id, label: t.name }))}
            />
            <Select
              aria-label="Page size"
              className="h-8 w-[5.75rem] text-[13px]"
              value={resume.meta.page_size}
              onValueChange={(page_size) => edit({ type: "meta/set", patch: { page_size } })}
              options={[
                { value: "A4", label: "A4" },
                { value: "Letter", label: "Letter" },
              ]}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={exporting !== null}
              icon={exporting === "pdf" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
              onClick={() => void download("pdf")}
            >
              PDF
            </Button>
            <Button
              size="sm"
              disabled={exporting !== null}
              icon={exporting === "docx" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
              onClick={() => void download("docx")}
            >
              DOCX
            </Button>
          </div>
        </div>
        {exportError && (
          <p role="alert" className="mx-auto max-w-[1400px] px-3 pb-2 text-[13px] text-danger sm:px-6">
            {exportError}
          </p>
        )}
        {/* Mobile: switch between editing and preview. */}
        <div className="px-3 pb-2 lg:hidden">
          <SegmentedTabs
            label="Editor view"
            value={mobileTab}
            onChange={setMobileTab}
            tabs={[
              { id: "edit", label: "Edit" },
              { id: "preview", label: "Preview" },
              { id: "analysis", label: "Analysis" },
              { id: "improve", label: "Improve" },
            ]}
          />
        </div>
      </div>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-3 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className={cn("flex min-w-0 flex-col gap-4", mobileTab !== "edit" && "hidden lg:flex")}>
          <UnsortedBanner resume={resume} />
          <ContactEditor contact={resume.contact} />
          {resume.sections.map((section, i) => (
            <SectionCard key={section.id} section={section} index={i} count={resume.sections.length} />
          ))}
          <Button className="self-start" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAddOpen(true)}>
            Add section
          </Button>
        </div>

        <aside
          aria-label={{ preview: "Preview", analysis: "Analysis", improve: "Improve" }[sideTab]}
          className={cn(
            "min-w-0 lg:sticky lg:top-[7.5rem] lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto lg:pb-6",
            mobileTab === "edit" && "hidden lg:block",
          )}
        >
          {/* Desktop: switch the side panel between preview, analysis and improve. */}
          <SegmentedTabs
            className="mb-3 hidden lg:flex"
            label="Side panel"
            value={sideTab}
            onChange={setSideTab}
            tabs={[
              { id: "preview", label: "Preview" },
              { id: "analysis", label: "Analysis" },
              { id: "improve", label: "Improve" },
            ]}
          />
          {/* Mobile shows the panel chosen by the Edit/Preview/Analysis tabs; desktop the side tab. */}
          <div className={cn(mobileTab === "preview" ? "block" : "hidden", sideTab === "preview" ? "lg:block" : "lg:hidden")}>
            <PdfPreview resume={resume} />
          </div>
          {(sideTab === "analysis" || mobileTab === "analysis") && (
            <div className={cn(mobileTab === "analysis" ? "block" : "hidden", sideTab === "analysis" ? "lg:block" : "lg:hidden")}>
              <AnalysisPanel resume={resume} onGoTo={goTo} />
            </div>
          )}
          {(sideTab === "improve" || mobileTab === "improve") && (
            <div className={cn(mobileTab === "improve" ? "block" : "hidden", sideTab === "improve" ? "lg:block" : "lg:hidden")}>
              <ImprovePanel resume={resume} edit={edit} onGoTo={goTo} />
            </div>
          )}
        </aside>
      </div>

      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        resume={resume}
        onRestore={(version) => editor.edit({ type: "resume/replace", resume: version })}
      />

      <AddSectionDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existing={resume.sections.map((s) => s.type)}
        onAdd={(sectionType) => {
          edit({ type: "section/add", sectionType });
          setAddOpen(false);
        }}
      />
    </EditContext.Provider>
  );
}

const UNSORTED_TITLE = "Imported text to review";

/** Shown while an imported resume still has text the importer could not place. */
function UnsortedBanner({ resume }: { resume: Resume }) {
  const section = resume.sections.find((s) => s.type === "custom" && s.title === UNSORTED_TITLE);
  if (!section) return null;
  const count = section.items.reduce((n, item) => n + ("bullets" in item ? item.bullets.length : 0), 0);
  if (count === 0) return null;
  return (
    <p role="status" className="flex gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-sm text-warning">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {count} {count === 1 ? "line" : "lines"} from your import could not be placed. They are in the hidden section
        “{UNSORTED_TITLE}” at the bottom: move each line where it belongs, then delete that section.
      </span>
    </p>
  );
}
