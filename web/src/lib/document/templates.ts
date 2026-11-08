/**
 * Templates are style configurations applied by one shared renderer, not
 * separate layouts. All templates are single-column with standard headings and
 * real text, which is what keeps them ATS-friendly.
 *
 * Sizes are in points. PDF uses the open fonts Carlito / Caladea, which are
 * metric-compatible with Calibri / Cambria used in the DOCX export, so both
 * exports have the same line breaks.
 */
export type TemplateId = "classic" | "modern" | "compact";

export interface TemplateStyle {
  id: TemplateId;
  name: string;
  description: string;
  pdfFont: "Carlito" | "Caladea";
  docxFont: "Calibri" | "Cambria";
  headerAlign: "left" | "center";
  headingStyle: "rule" | "accent";
  headingUppercase: boolean;
  accent: string;
  text: string;
  muted: string;
  nameSize: number;
  headlineSize: number;
  headingSize: number;
  baseSize: number;
  smallSize: number;
  lineHeight: number;
  margin: number;
  sectionGap: number;
  entryGap: number;
}

export const TEMPLATES: Record<TemplateId, TemplateStyle> = {
  classic: {
    id: "classic",
    name: "Classic",
    description: "Traditional serif layout with centred header. Suits any industry.",
    pdfFont: "Caladea",
    docxFont: "Cambria",
    headerAlign: "center",
    headingStyle: "rule",
    headingUppercase: true,
    accent: "#1c1d1f",
    text: "#1c1d1f",
    muted: "#4a4c50",
    nameSize: 22,
    headlineSize: 11.5,
    headingSize: 11,
    baseSize: 10.5,
    smallSize: 9.5,
    lineHeight: 1.3,
    margin: 46,
    sectionGap: 13,
    entryGap: 8,
  },
  modern: {
    id: "modern",
    name: "Modern",
    description: "Clean sans-serif with a restrained blue accent.",
    pdfFont: "Carlito",
    docxFont: "Calibri",
    headerAlign: "left",
    headingStyle: "accent",
    headingUppercase: false,
    accent: "#2c4bb4",
    text: "#1c1d1f",
    muted: "#4a4c50",
    nameSize: 24,
    headlineSize: 12,
    headingSize: 12.5,
    baseSize: 10.5,
    smallSize: 9.5,
    lineHeight: 1.3,
    margin: 44,
    sectionGap: 14,
    entryGap: 8,
  },
  compact: {
    id: "compact",
    name: "Compact",
    description: "Tighter spacing to fit more experience on one page.",
    pdfFont: "Carlito",
    docxFont: "Calibri",
    headerAlign: "left",
    headingStyle: "rule",
    headingUppercase: true,
    accent: "#1c1d1f",
    text: "#1c1d1f",
    muted: "#4a4c50",
    nameSize: 19,
    headlineSize: 10.5,
    headingSize: 10,
    baseSize: 9.75,
    smallSize: 9,
    lineHeight: 1.22,
    margin: 34,
    sectionGap: 9,
    entryGap: 5,
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

export function getTemplate(id: string): TemplateStyle {
  return TEMPLATES[id as TemplateId] ?? TEMPLATES.classic;
}
