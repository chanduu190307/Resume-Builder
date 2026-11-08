/**
 * DOCX export. Draws the same ResumeDocument with the same template settings as
 * the PDF. Uses Calibri / Cambria, which Carlito / Caladea (PDF) are
 * metric-compatible with. Single column, real paragraphs, no tables or text boxes.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from "docx";
import type { DocEntry, DocLine, ResumeDocument } from "../document/buildDocument.ts";
import { getTemplate, type TemplateStyle } from "../document/templates.ts";

const PAGE_TWIPS = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
} as const;

const twips = (pt: number) => Math.round(pt * 20);
const halfPoints = (pt: number) => Math.round(pt * 2);
const hex = (color: string) => color.replace("#", "").toUpperCase();
// Word's "single" line for Calibri/Cambria is ~1.22em; scale so spacing matches the PDF.
const lineSpacing = (t: TemplateStyle) => Math.round((240 * t.lineHeight) / 1.22);

function run(text: string, t: TemplateStyle, opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italics,
    size: halfPoints(opts.size ?? t.baseSize),
    color: hex(opts.color ?? t.text),
    font: t.docxFont,
  });
}

/** A run that starts with a real Word tab (<w:tab/>); a "	" character inside text is not a tab in Word. */
function tabRun(text: string, t: TemplateStyle, opts: { size?: number; color?: string } = {}) {
  return new TextRun({
    children: [new Tab(), text],
    size: halfPoints(opts.size ?? t.baseSize),
    color: hex(opts.color ?? t.text),
    font: t.docxFont,
  });
}

function linkOrText(text: string, href: string | undefined, t: TemplateStyle, size?: number, color?: string): ParagraphChild {
  const r = run(text, t, { size, color });
  return href ? new ExternalHyperlink({ link: href, children: [r] }) : r;
}

function entryParagraphs(entry: DocEntry, t: TemplateStyle, contentWidth: number, isFirst: boolean): Paragraph[] {
  const rightTab = [{ type: TabStopType.RIGHT, position: contentWidth }];
  const out: Paragraph[] = [];
  // The entry gap goes above the entry's first paragraph (none for the first entry under a heading).
  let pendingGap = isFirst ? 0 : twips(t.entryGap);
  const before = (base: number) => {
    const value = base + pendingGap;
    pendingGap = 0;
    return value;
  };

  if (entry.title || entry.titleRight) {
    out.push(
      new Paragraph({
        tabStops: rightTab,
        keepNext: true,
        keepLines: true,
        spacing: { line: lineSpacing(t), before: before(0), after: 0 },
        children: [
          run(entry.title ?? "", t, { bold: true }),
          ...(entry.titleRight ? [tabRun(entry.titleRight, t, { size: t.smallSize + 0.25, color: t.muted })] : []),
        ],
      }),
    );
  }
  if (entry.subtitle || entry.subtitleRight) {
    out.push(
      new Paragraph({
        tabStops: rightTab,
        keepNext: entry.lines.length + entry.bullets.length + (entry.afterBullets?.length ?? 0) > 0,
        keepLines: true,
        spacing: { line: lineSpacing(t), before: before(0), after: 0 },
        children: [
          run(entry.subtitle ?? "", t, { italics: true }),
          ...(entry.subtitleRight
            ? [tabRun("", t), linkOrText(entry.subtitleRight, entry.subtitleRightHref, t, t.smallSize + 0.25, t.muted)]
            : []),
        ],
      }),
    );
  }
  for (const line of entry.lines) out.push(lineParagraph(line, t, before(20)));
  for (const bullet of entry.bullets) {
    out.push(
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        keepLines: true,
        spacing: { line: lineSpacing(t), before: before(30), after: 0 },
        children: [run(bullet, t)],
      }),
    );
  }
  for (const line of entry.afterBullets ?? []) out.push(lineParagraph(line, t, before(20)));
  return out;
}

function lineParagraph(line: DocLine, t: TemplateStyle, before: number): Paragraph {
  return new Paragraph({
    keepLines: true,
    spacing: { line: lineSpacing(t), before, after: 0 },
    children: [
      ...(line.label ? [run(`${line.label}: `, t, { bold: true })] : []),
      linkOrText(line.text, line.href, t),
    ],
  });
}

export function buildDocx(doc: ResumeDocument): Document {
  const t = getTemplate(doc.template);
  const page = PAGE_TWIPS[doc.pageSize];
  const margin = twips(t.margin);
  const contentWidth = page.width - 2 * margin;
  const align = t.headerAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;

  const children: Paragraph[] = [];

  if (doc.name) {
    children.push(new Paragraph({ alignment: align, children: [run(doc.name, t, { bold: true, size: t.nameSize })] }));
  }
  if (doc.headline) {
    children.push(
      new Paragraph({
        alignment: align,
        spacing: { before: 40 },
        children: [run(doc.headline, t, { size: t.headlineSize, color: t.muted })],
      }),
    );
  }
  if (doc.contact.length) {
    const parts: ParagraphChild[] = [];
    doc.contact.forEach((part, i) => {
      if (i > 0) parts.push(run("  |  ", t, { size: t.smallSize, color: t.muted }));
      parts.push(linkOrText(part.text, part.href, t, t.smallSize, t.muted));
    });
    children.push(new Paragraph({ alignment: align, spacing: { before: 80 }, children: parts }));
  }

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: twips(t.sectionGap), after: twips(t.entryGap - 2) },
        border:
          t.headingStyle === "rule"
            ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9A9CA1", space: 1 } }
            : undefined,
        children: [
          run(t.headingUppercase ? section.title.toUpperCase() : section.title, t, {
            bold: true,
            size: t.headingSize,
            color: t.accent,
          }),
        ],
      }),
    );
    section.entries.forEach((entry, i) => children.push(...entryParagraphs(entry, t, contentWidth, i === 0)));
  }

  return new Document({
    creator: "Resume Builder",
    title: doc.name ? `${doc.name} - Resume` : "Resume",
    styles: {
      default: { document: { run: { font: t.docxFont, size: halfPoints(t.baseSize), color: hex(t.text) } } },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 220, hanging: 200 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height },
            margin: { top: margin, bottom: margin, left: margin, right: margin },
          },
        },
        children,
      },
    ],
  });
}

export function renderDocxBlob(doc: ResumeDocument): Promise<Blob> {
  return Packer.toBlob(buildDocx(doc));
}
