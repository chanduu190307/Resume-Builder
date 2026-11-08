/**
 * Converts a Resume into a format-neutral document model. The PDF and DOCX
 * renderers only draw this model, so every content decision (what is shown,
 * ordering, date format, labels) is made here, once, and tested once.
 *
 * Rules:
 * - Hidden sections are omitted. Everything visible and non-empty is included.
 * - Nothing is added that the user did not write (only formatting and labels).
 * - Empty items and sections are skipped so blank form rows never print.
 */
import { formatDate, formatRange } from "../format/dates.ts";
import { displayUrl, toHref } from "../format/links.ts";
import type { ItemOf, PartialDate, Resume, Section } from "../../types/resume.ts";

type EmploymentTypeValue = NonNullable<ItemOf<"experience">["employment_type"]>;

export interface DocLine {
  label?: string;
  text: string;
  href?: string;
}

export interface DocEntry {
  title?: string;
  titleRight?: string;
  subtitle?: string;
  subtitleRight?: string;
  subtitleRightHref?: string;
  lines: DocLine[];
  bullets: string[];
  /** Lines printed after the bullets (e.g. "Technologies: ..."); achievements read first. */
  afterBullets?: DocLine[];
}

export interface DocSection {
  id: string;
  title: string;
  entries: DocEntry[];
}

export interface ContactPart {
  text: string;
  href?: string;
}

export interface ResumeDocument {
  name: string;
  headline?: string;
  contact: ContactPart[];
  sections: DocSection[];
  pageSize: "A4" | "Letter";
  template: string;
}

const EMPLOYMENT_LABEL: Record<EmploymentTypeValue, string | null> = {
  full_time: null,
  part_time: "Part-time",
  internship: "Internship",
  contract: "Contract",
  freelance: "Freelance",
  volunteer: "Volunteer",
  other: null,
};

const clean = (value: string | null | undefined): string => (value ?? "").trim();

function joinNonEmpty(parts: (string | null | undefined)[], sep: string): string {
  return parts.map(clean).filter(Boolean).join(sep);
}

function bulletsOf(bullets: { text: string }[]): string[] {
  return bullets.map((b) => clean(b.text)).filter(Boolean);
}

function technologiesLine(technologies: string[]): DocLine[] {
  const text = technologies.map(clean).filter(Boolean).join(", ");
  return text ? [{ label: "Technologies", text }] : [];
}

function urlLine(url: string | null, label?: string): DocLine[] {
  const value = clean(url);
  if (!value) return [];
  return [{ ...(label ? { label } : {}), text: displayUrl(value), href: toHref(value) }];
}

function textLine(text: string | null, label?: string): DocLine[] {
  const value = clean(text);
  return value ? [{ ...(label ? { label } : {}), text: value }] : [];
}

function isEmptyEntry(entry: DocEntry): boolean {
  return !entry.title && !entry.titleRight && !entry.subtitle && !entry.subtitleRight
    && entry.lines.length === 0 && entry.bullets.length === 0 && !entry.afterBullets?.length;
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([k, v]) => v !== "" && v !== undefined && !(k === "afterBullets" && Array.isArray(v) && v.length === 0)),
  ) as T;
}

function certificationDates(issued: PartialDate | null, expires: PartialDate | null): string {
  const from = formatDate(issued);
  const to = formatDate(expires);
  if (from && to) return `${from} – Expires ${to}`;
  if (to) return `Expires ${to}`;
  return from;
}

const BUILDERS: { [K in Section["type"]]: (item: ItemOf<K>) => DocEntry[] } = {
  summary: (it) => (clean(it.text) ? [{ lines: [{ text: clean(it.text) }], bullets: [] }] : []),

  experience: (it) => [
    compact({
      title: clean(it.title),
      titleRight: formatRange(it.start, it.end, it.current),
      subtitle: joinNonEmpty(
        [it.organization, it.employment_type ? EMPLOYMENT_LABEL[it.employment_type] : null],
        " · ",
      ),
      subtitleRight: clean(it.location),
      lines: [],
      bullets: bulletsOf(it.bullets),
      afterBullets: technologiesLine(it.technologies),
    }),
  ],

  education: (it) => {
    const degree = joinNonEmpty([it.degree, it.field_of_study], ", ");
    return [
      compact({
        title: degree || clean(it.institution),
        titleRight: formatRange(it.start, it.end, it.current),
        subtitle: degree ? clean(it.institution) : "",
        subtitleRight: clean(it.location),
        lines: textLine(it.grade),
        bullets: bulletsOf(it.bullets),
      }),
    ];
  },

  projects: (it) => {
    const url = clean(it.url);
    return [
      compact({
        title: clean(it.name),
        titleRight: formatRange(it.start, it.end, it.current),
        subtitle: joinNonEmpty([it.role, it.organization], " · "),
        subtitleRight: url ? displayUrl(url) : "",
        subtitleRightHref: url ? toHref(url) : undefined,
        lines: [],
        bullets: bulletsOf(it.bullets),
        afterBullets: technologiesLine(it.technologies),
      }),
    ];
  },

  // All groups of one skills section render as a single entry of labelled lines.
  skills: (it) => {
    const text = it.skills.map(clean).filter(Boolean).join(", ");
    if (!text) return [];
    return [{ lines: [{ ...(clean(it.name) ? { label: clean(it.name) } : {}), text }], bullets: [] }];
  },

  certifications: (it) => [
    compact({
      title: clean(it.name),
      titleRight: certificationDates(it.issued, it.expires),
      subtitle: clean(it.issuer),
      lines: [...textLine(it.credential_id, "Credential ID"), ...urlLine(it.url)],
      bullets: [],
    }),
  ],

  publications: (it) => [
    compact({
      title: clean(it.title),
      titleRight: formatDate(it.date),
      subtitle: clean(it.publisher),
      lines: [...textLine(it.authors), ...textLine(it.description), ...urlLine(it.url)],
      bullets: [],
    }),
  ],

  // Languages render as one combined line, see mergeInline below.
  languages: (it) => {
    const language = clean(it.language);
    if (!language) return [];
    const proficiency = clean(it.proficiency);
    return [{ lines: [{ text: proficiency ? `${language} (${proficiency})` : language }], bullets: [] }];
  },

  awards: (it) => [
    compact({
      title: clean(it.title),
      titleRight: formatDate(it.date),
      subtitle: clean(it.issuer),
      lines: textLine(it.description),
      bullets: [],
    }),
  ],

  custom: (it) => [
    compact({
      title: clean(it.title),
      titleRight: clean(it.date_text),
      subtitle: clean(it.subtitle),
      subtitleRight: clean(it.location),
      lines: [],
      bullets: bulletsOf(it.bullets),
    }),
  ],
};

function buildSection(section: Section): DocSection | null {
  const build = BUILDERS[section.type] as (item: Section["items"][number]) => DocEntry[];
  let entries = (section.items as Section["items"][number][]).flatMap(build).filter((e) => !isEmptyEntry(e));

  if (section.type === "skills") {
    entries = entries.length ? [{ lines: entries.flatMap((e) => e.lines), bullets: [] }] : [];
  } else if (section.type === "languages") {
    const text = entries.flatMap((e) => e.lines.map((l) => l.text)).join(" · ");
    entries = text ? [{ lines: [{ text }], bullets: [] }] : [];
  }

  if (entries.length === 0) return null;
  return { id: section.id, title: clean(section.title), entries };
}

export function buildDocument(resume: Resume): ResumeDocument {
  const c = resume.contact;
  const contact: ContactPart[] = [];
  if (clean(c.email)) contact.push({ text: clean(c.email), href: `mailto:${clean(c.email)}` });
  if (clean(c.phone)) contact.push({ text: clean(c.phone) });
  if (clean(c.location)) contact.push({ text: clean(c.location) });
  for (const link of c.links) {
    if (clean(link.url)) contact.push({ text: displayUrl(link.url), href: toHref(link.url) });
  }

  return compact({
    name: clean(c.full_name),
    headline: clean(c.headline),
    contact,
    sections: resume.sections.filter((s) => s.visible).map(buildSection).filter((s): s is DocSection => s !== null),
    pageSize: resume.meta.page_size,
    template: resume.meta.template,
  });
}

/** Every piece of text in the document, in reading order (used by tests and, later, ATS views). */
export function documentText(doc: ResumeDocument): string[] {
  const out: string[] = [doc.name];
  if (doc.headline) out.push(doc.headline);
  out.push(...doc.contact.map((p) => p.text));
  for (const section of doc.sections) {
    out.push(section.title);
    for (const e of section.entries) {
      for (const v of [e.title, e.titleRight, e.subtitle, e.subtitleRight]) if (v) out.push(v);
      for (const l of e.lines) out.push(l.label ? `${l.label}: ${l.text}` : l.text);
      out.push(...e.bullets);
      for (const l of e.afterBullets ?? []) out.push(l.label ? `${l.label}: ${l.text}` : l.text);
    }
  }
  return out.filter(Boolean);
}
