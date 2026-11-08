/** Cover letter draft built only from the resume and the job; editable, saved with the job. */
import { Copy, Download, FileText, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { describeError, draftCoverLetter } from "../../lib/api.ts";
import { downloadBlob } from "../../lib/download.ts";
import type { JobAnalysis } from "../../types/jobs.generated.ts";
import type { Resume } from "../../types/resume.ts";
import { Button } from "../ui/Button.tsx";

interface Props {
  resume: Resume;
  analysis: JobAnalysis;
  initialText: string;
  aiAvailable: boolean;
  onSave: (text: string) => void;
}

export function CoverLetterPanel({ resume, analysis, initialText, aiAvailable, onSave }: Props) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<"draft" | "ai" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async (polish: boolean) => {
    if (text.trim() && !polish && !window.confirm("Replace your current letter with a new draft?")) return;
    setBusy(polish ? "ai" : "draft");
    setError(null);
    setMessage(null);
    try {
      const result = await draftCoverLetter(resume, analysis, polish);
      setText(result.text);
      onSave(result.text);
      if (polish && result.method !== "ai") {
        setMessage(`The AI version was discarded because it ${result.rejected_reasons.join("; ")}. The draft is shown instead.`);
      }
    } catch (err) {
      setError(describeError(err, "The cover letter could not be created."));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setMessage("Copied to the clipboard.");
  };

  return (
    <section aria-label="Cover letter" className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Assembled only from your resume and the job description, so it makes no claims you have not made. Read it,
        personalise it, and make sure every sentence is true before sending.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void generate(false)}
          icon={busy === "draft" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}>
          {text.trim() ? "New draft" : "Draft from my resume"}
        </Button>
        <Button size="sm" disabled={busy !== null || !aiAvailable || !text.trim()} title={aiAvailable ? "Smooth the wording; facts are checked." : "AI is not configured."}
          onClick={() => void generate(true)}
          icon={busy === "ai" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}>
          Polish with AI
        </Button>
        {text.trim() && (
          <>
            <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" aria-hidden />} onClick={() => void copy()}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" aria-hidden />}
              onClick={() => downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "Cover_Letter.txt")}>
              Download .txt
            </Button>
          </>
        )}
      </div>
      {message && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {text.trim() !== "" || busy ? (
        <textarea
          aria-label="Cover letter text"
          value={text}
          rows={22}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onSave(text)}
          className="w-full rounded-card border border-line bg-surface p-4 text-[13px] leading-relaxed shadow-card focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
        />
      ) : null}
    </section>
  );
}
