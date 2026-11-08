/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: shared/schema/resume.schema.json (from engine/src/resume_engine/schema).
 * Regenerate: npm run gen:types
 */

/**
 * A complete resume. Section order in ``sections`` is the display order.
 */
export interface Resume {
  contact: Contact;
  id: string;
  meta: ResumeMeta;
  schema_version: "1.0";
  sections: (
    | SummarySection
    | ExperienceSection
    | EducationSection
    | ProjectsSection
    | SkillsSection
    | CertificationsSection
    | PublicationsSection
    | LanguagesSection
    | AwardsSection
    | CustomSection
  )[];
}
export interface Contact {
  email: string | null;
  full_name: string;
  /**
   * Professional title shown under the name.
   */
  headline: string | null;
  links: Link[];
  location: string | null;
  phone: string | null;
}
export interface Link {
  id: string;
  kind: "linkedin" | "github" | "portfolio" | "website" | "other";
  label: string | null;
  url: string;
}
export interface ResumeMeta {
  page_size: "A4" | "Letter";
  template: string;
  /**
   * Name of this resume version.
   */
  title: string;
}
export interface SummarySection {
  id: string;
  items: SummaryItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "summary";
  visible: boolean;
}
export interface SummaryItem {
  id: string;
  kind: "summary" | "objective";
  origin: "user" | "ai_assisted";
  text: string;
}
/**
 * Also used for internships and volunteering (see ``employment_type``).
 */
export interface ExperienceSection {
  id: string;
  items: ExperienceItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "experience";
  visible: boolean;
}
export interface ExperienceItem {
  bullets: Bullet[];
  /**
   * True if this is ongoing ('Present').
   */
  current: boolean;
  employment_type: ("full_time" | "part_time" | "internship" | "contract" | "freelance" | "volunteer" | "other") | null;
  end: PartialDate | null;
  id: string;
  location: string | null;
  /**
   * Company or organisation.
   */
  organization: string;
  start: PartialDate | null;
  technologies: string[];
  /**
   * Job title.
   */
  title: string;
}
export interface Bullet {
  id: string;
  origin: "user" | "ai_assisted";
  text: string;
}
/**
 * A date that may be known only to the year (``2021``) or year+month.
 */
export interface PartialDate {
  month: number | null;
  year: number;
}
export interface EducationSection {
  id: string;
  items: EducationItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "education";
  visible: boolean;
}
export interface EducationItem {
  bullets: Bullet[];
  /**
   * True if this is ongoing ('Present').
   */
  current: boolean;
  degree: string | null;
  end: PartialDate | null;
  field_of_study: string | null;
  /**
   * Kept verbatim, e.g. 'CGPA 8.4/10' or '3.7 GPA'.
   */
  grade: string | null;
  id: string;
  institution: string;
  location: string | null;
  start: PartialDate | null;
}
export interface ProjectsSection {
  id: string;
  items: ProjectItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "projects";
  visible: boolean;
}
export interface ProjectItem {
  bullets: Bullet[];
  /**
   * True if this is ongoing ('Present').
   */
  current: boolean;
  end: PartialDate | null;
  id: string;
  name: string;
  /**
   * Company, course or club the project was for.
   */
  organization: string | null;
  role: string | null;
  start: PartialDate | null;
  technologies: string[];
  url: string | null;
}
export interface SkillsSection {
  id: string;
  items: SkillGroup[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "skills";
  visible: boolean;
}
export interface SkillGroup {
  id: string;
  kind: "technical" | "tool" | "soft" | "domain" | "other";
  /**
   * Group label, e.g. 'Languages' or 'Cloud'.
   */
  name: string | null;
  skills: string[];
}
export interface CertificationsSection {
  id: string;
  items: CertificationItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "certifications";
  visible: boolean;
}
export interface CertificationItem {
  credential_id: string | null;
  expires: PartialDate | null;
  id: string;
  issued: PartialDate | null;
  issuer: string | null;
  name: string;
  url: string | null;
}
export interface PublicationsSection {
  id: string;
  items: PublicationItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "publications";
  visible: boolean;
}
export interface PublicationItem {
  authors: string | null;
  date: PartialDate | null;
  description: string | null;
  id: string;
  publisher: string | null;
  title: string;
  url: string | null;
}
export interface LanguagesSection {
  id: string;
  items: LanguageItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "languages";
  visible: boolean;
}
export interface LanguageItem {
  id: string;
  language: string;
  /**
   * Kept verbatim, e.g. 'Native' or 'B2'.
   */
  proficiency: string | null;
}
export interface AwardsSection {
  id: string;
  items: AwardItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "awards";
  visible: boolean;
}
export interface AwardItem {
  date: PartialDate | null;
  description: string | null;
  id: string;
  issuer: string | null;
  title: string;
}
export interface CustomSection {
  id: string;
  items: CustomItem[];
  /**
   * Heading shown on the resume; user-editable.
   */
  title: string;
  type: "custom";
  visible: boolean;
}
export interface CustomItem {
  bullets: Bullet[];
  /**
   * Free-form date text for unusual sections.
   */
  date_text: string | null;
  id: string;
  location: string | null;
  subtitle: string | null;
  title: string;
}
