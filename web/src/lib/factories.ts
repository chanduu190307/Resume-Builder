/**
 * Factories for empty resume parts. Every field required by the generated types
 * is set explicitly so new objects always match the engine's output schema.
 * Factories never invent content: all text starts empty.
 */
import { newId } from "./ids.ts";
import type {
  Bullet,
  ItemOf,
  Link,
  Resume,
  Section,
  SectionOf,
  SectionType,
} from "../types/resume.ts";

export function createBullet(text = ""): Bullet {
  return { id: newId(), text, origin: "user" };
}

export function createLink(): Link {
  return { id: newId(), kind: "other", label: null, url: "" };
}

const range = { start: null, end: null, current: false } as const;

export function createItem<T extends SectionType>(type: T): ItemOf<T> {
  const id = newId();
  const items: { [K in SectionType]: () => ItemOf<K> } = {
    summary: () => ({ id, kind: "summary", text: "", origin: "user" }),
    experience: () => ({
      id, title: "", organization: "", location: null, employment_type: null,
      technologies: [], bullets: [createBullet()], ...range,
    }),
    education: () => ({
      id, institution: "", degree: null, field_of_study: null, location: null, grade: null,
      bullets: [], ...range,
    }),
    projects: () => ({
      id, name: "", role: null, organization: null, url: null, technologies: [],
      bullets: [createBullet()], ...range,
    }),
    skills: () => ({ id, name: null, kind: "technical", skills: [] }),
    certifications: () => ({
      id, name: "", issuer: null, issued: null, expires: null, credential_id: null, url: null,
    }),
    publications: () => ({
      id, title: "", publisher: null, authors: null, date: null, url: null, description: null,
    }),
    languages: () => ({ id, language: "", proficiency: null }),
    awards: () => ({ id, title: "", issuer: null, date: null, description: null }),
    custom: () => ({ id, title: "", subtitle: null, date_text: null, location: null, bullets: [createBullet()] }),
  };
  return items[type]() as ItemOf<T>;
}

export function createSection<T extends SectionType>(type: T, title?: string): SectionOf<T> {
  return {
    id: newId(),
    type,
    title: title ?? SECTION_META[type].defaultTitle,
    visible: true,
    items: [createItem(type)],
  } as unknown as SectionOf<T>;
}

export function createResume(title = "Untitled resume"): Resume {
  return {
    schema_version: "1.0",
    id: newId(),
    meta: { title, template: "classic", page_size: "A4" },
    contact: { full_name: "", headline: null, email: null, phone: null, location: null, links: [] },
    sections: (["summary", "experience", "education", "skills"] as const).map(
      (type) => createSection(type) as Section,
    ),
  };
}

/** Deep copy with a fresh resume id (item ids only need to be unique within a resume). */
export function duplicateResume(resume: Resume, title: string): Resume {
  const copy = structuredClone(resume);
  copy.id = newId();
  copy.meta = { ...copy.meta, title };
  return copy;
}

export interface SectionMeta {
  defaultTitle: string;
  label: string;
  description: string;
  /** Inline guidance shown in the editor. Advice only; never generates content. */
  guidance: string;
  itemNoun: string;
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  summary: {
    defaultTitle: "Summary",
    label: "Summary / Objective",
    description: "A short introduction at the top of your resume.",
    guidance:
      "2-4 sentences: who you are professionally, your strongest relevant experience, and what you are looking for. Only mention skills you can back up below.",
    itemNoun: "paragraph",
  },
  experience: {
    defaultTitle: "Experience",
    label: "Experience",
    description: "Jobs, internships, freelance or volunteer roles.",
    guidance:
      "Start each bullet with an action verb (Built, Led, Reduced...). Say what you did and the result. Add numbers only if they are real and you could explain them in an interview.",
    itemNoun: "role",
  },
  education: {
    defaultTitle: "Education",
    label: "Education",
    description: "Degrees, diplomas and schooling.",
    guidance:
      "List the most recent first. Include your grade only if it helps you. Students can add relevant coursework or honours as bullets.",
    itemNoun: "entry",
  },
  projects: {
    defaultTitle: "Projects",
    label: "Projects",
    description: "Personal, academic or open-source work.",
    guidance:
      "Describe the problem, what you built and the technologies used. Link to the code or a demo if it is public.",
    itemNoun: "project",
  },
  skills: {
    defaultTitle: "Skills",
    label: "Skills",
    description: "Technical, tool and soft skills, optionally grouped.",
    guidance:
      "Group related skills (e.g. Languages, Frameworks, Tools). List skills you have actually used; the strongest evidence is a bullet elsewhere that shows the skill in action.",
    itemNoun: "group",
  },
  certifications: {
    defaultTitle: "Certifications",
    label: "Certifications & licenses",
    description: "Professional certifications and licenses.",
    guidance: "Use the official certification name and issuer. Add the credential ID if employers can verify it.",
    itemNoun: "certification",
  },
  publications: {
    defaultTitle: "Publications",
    label: "Publications",
    description: "Papers, articles and books.",
    guidance: "Use a consistent citation style. List authors in the published order.",
    itemNoun: "publication",
  },
  languages: {
    defaultTitle: "Languages",
    label: "Languages",
    description: "Spoken languages and proficiency.",
    guidance: "Describe proficiency honestly, e.g. Native, Fluent, Professional, Intermediate, Basic, or a CEFR level (B2).",
    itemNoun: "language",
  },
  awards: {
    defaultTitle: "Awards",
    label: "Awards & honours",
    description: "Scholarships, prizes and recognition.",
    guidance: "Briefly say what the award recognised if the name does not make it obvious.",
    itemNoun: "award",
  },
  custom: {
    defaultTitle: "Additional Information",
    label: "Custom section",
    description: "Anything else: activities, volunteering, leadership...",
    guidance: "Use a clear heading. Keep entries relevant to the roles you are applying for.",
    itemNoun: "entry",
  },
};

export const SECTION_TYPES = Object.keys(SECTION_META) as SectionType[];
