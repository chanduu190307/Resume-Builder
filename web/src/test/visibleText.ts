/**
 * Independently enumerates what *should* be printed for a resume: every value
 * the user entered in visible sections, formatted the way the exports print it.
 * Deliberately does not reuse buildDocument, so it can catch omissions there.
 */
import { formatDate } from "../lib/format/dates.ts";
import { displayUrl } from "../lib/format/links.ts";
import type { Resume } from "../types/resume.ts";

const SKIP_KEYS = new Set(["id", "origin", "kind", "type", "visible", "current", "employment_type"]);
const URL_KEYS = new Set(["url"]);
const DATE_KEYS = new Set(["start", "end", "issued", "expires", "date"]);

const EMPLOYMENT_LABELS: Record<string, string> = {
  part_time: "Part-time",
  internship: "Internship",
  contract: "Contract",
  freelance: "Freelance",
  volunteer: "Volunteer",
};

function collect(value: unknown, key: string, out: string[]): void {
  if (value === null || value === undefined || SKIP_KEYS.has(key)) return;
  if (DATE_KEYS.has(key)) {
    const text = formatDate(value as { year: number; month: number | null });
    if (text) out.push(text);
    return;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(URL_KEYS.has(key) ? displayUrl(text) : text);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collect(v, key, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collect(v, k, out);
  }
}

export interface ExpectedText {
  visible: string[];
  hidden: string[];
}

export function expectedText(resume: Resume): ExpectedText {
  const visible: string[] = [];
  const c = resume.contact;
  collect({ full_name: c.full_name, headline: c.headline, email: c.email, phone: c.phone, location: c.location }, "", visible);
  for (const link of c.links) collect(link.url, "url", visible);

  const hidden: string[] = [];
  for (const section of resume.sections) {
    const target = section.visible ? visible : hidden;
    target.push(section.title.trim());
    for (const item of section.items) {
      collect(item, "", target);
      const type = (item as { employment_type?: string | null }).employment_type;
      if (type && EMPLOYMENT_LABELS[type] && section.visible) visible.push(EMPLOYMENT_LABELS[type]);
      if ((item as { current?: boolean }).current && section.visible) visible.push("Present");
    }
  }
  // Link labels are not printed (the URL is); drop them from expectations.
  const labels = new Set(c.links.map((l) => l.label?.trim()).filter(Boolean));
  return { visible: visible.filter((t) => !labels.has(t)), hidden };
}

/** Collapses whitespace so text wrapped across lines still matches. */
export const squash = (text: string) => text.replace(/\s+/g, " ").trim();
