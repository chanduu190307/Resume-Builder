/**
 * Live preview that renders the *actual exported PDF* (same bytes as Download
 * PDF) with pdf.js. What you see, including page breaks, is what you get.
 */
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDebounced } from "../../lib/useDebounced.ts";
import type { Resume } from "../../types/resume.ts";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return pdfjsPromise;
}

const PREVIEW_DEBOUNCE_MS = 450;
const RECOMMENDED_MAX_PAGES = 2;

export function PdfPreview({ resume }: { resume: Resume }) {
  const debounced = useDebounced(resume, PREVIEW_DEBOUNCE_MS);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<"rendering" | "ready" | "error">("rendering");

  // Re-render at a resolution matching the container (rounded to limit re-renders while resizing).
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round((entry?.contentRect.width ?? 0) / 50) * 50;
      setWidth((prev) => (prev === w ? prev : w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    setStatus("rendering");

    (async () => {
      const [{ renderPdfBlob }, pdfjs] = await Promise.all([import("../../lib/render/exporters.tsx"), loadPdfJs()]);
      const blob = await renderPdfBlob(debounced);
      if (cancelled) return;
      const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
      const pdf = await task.promise;
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const sheets: HTMLElement[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: (width * dpr) / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "block h-auto w-full";
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
          const sheet = document.createElement("div");
          sheet.className = "preview-sheet overflow-hidden rounded-[3px] bg-white shadow-float ring-1 ring-line";
          sheet.setAttribute("role", "img");
          sheet.setAttribute("aria-label", `Resume preview, page ${n} of ${pdf.numPages}`);
          sheet.appendChild(canvas);
          sheets.push(sheet);
        }
        if (cancelled) return;
        // Swap all pages at once to avoid flicker.
        pagesRef.current?.replaceChildren(...sheets);
        setPageCount(pdf.numPages);
        setStatus("ready");
      } finally {
        void task.destroy();
      }
    })().catch((err: unknown) => {
      if (cancelled) return;
      console.error("preview failed", err);
      setStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [debounced, width]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 items-center justify-between text-xs text-ink-muted">
        <span>{pageCount > 0 ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : " "}</span>
        {status === "rendering" && (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating preview
          </span>
        )}
      </div>
      {status === "error" && (
        <p className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> The preview could not be generated. Your resume is still saved.
        </p>
      )}
      {pageCount > RECOMMENDED_MAX_PAGES && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          Your resume is {pageCount} pages. Most recruiters expect 1-2 pages; consider the Compact template or trimming older details.
        </p>
      )}
      {/* Pages sit as a slightly tilted 3D stack and lie flat as soon as you point at or focus them. */}
      <div className="preview-stage">
        <div ref={pagesRef} className="preview-pages flex flex-col gap-4" aria-live="off" />
      </div>
    </div>
  );
}
