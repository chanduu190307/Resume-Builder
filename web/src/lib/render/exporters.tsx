/**
 * Browser entry points for preview and export. This module is loaded lazily
 * (it pulls in react-pdf and docx), so the rest of the app stays light.
 */
import { pdf } from "@react-pdf/renderer";
import { buildDocument } from "../document/buildDocument.ts";
import type { Resume } from "../../types/resume.ts";
import { renderDocxBlob } from "./docx.ts";
import { preparePdfFonts } from "./fonts.ts";
import { ResumePdf } from "./ResumePdf.tsx";

export async function renderPdfBlob(resume: Resume): Promise<Blob> {
  await preparePdfFonts(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/fonts`);
  return pdf(<ResumePdf doc={buildDocument(resume)} />).toBlob();
}

export function renderResumeDocx(resume: Resume): Promise<Blob> {
  return renderDocxBlob(buildDocument(resume));
}
