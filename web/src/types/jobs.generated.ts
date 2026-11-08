/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: shared/schema/jobs.schema.json (from engine/src/resume_engine/jobs).
 * Regenerate: npm run gen:types
 */

/**
 * Not an endpoint: bundles every jobs type so one TypeScript file can be generated.
 */
export interface JobsContract {
  analysis: JobAnalysis;
  cover_letter: CoverLetter;
  fetched: FetchedJobOut;
  rewrite: RewriteResult;
  tailor: TailorResponse;
}
export interface JobAnalysis {
  company: string | null;
  /**
   * 'or equivalent experience' accepted
   */
  education_alternative: boolean;
  /**
   * 1 school, 2 associate, 3 bachelor, 4 master, 5 doctorate
   */
  education_level: number | null;
  education_text: string | null;
  keywords: JobKeyword[];
  method: "rules" | "llm";
  requirements: JobRequirement[];
  text: string;
  title: string | null;
  years_required: number | null;
}
export interface JobKeyword {
  count: number;
  importance: "required" | "preferred" | "mentioned";
  skill: string;
  /**
   * How the job description writes it, e.g. 'React.js'.
   */
  term: string;
  weight: number;
}
export interface JobRequirement {
  category: "skill" | "experience" | "education" | "certification" | "other";
  id: string;
  kind: "required" | "preferred" | "responsibility";
  skills: string[];
  /**
   * Verbatim from the job description.
   */
  text: string;
  years: number | null;
}
export interface CoverLetter {
  /**
   * draft (assembled from your resume) or ai (polished, guard-checked)
   */
  method: string;
  rejected_reasons: string[];
  text: string;
}
export interface FetchedJobOut {
  company: string | null;
  source: string;
  text: string;
  title: string | null;
  url: string;
}
export interface RewriteResult {
  rejected: Rejected[];
  suggestions: Suggestion[];
}
export interface Rejected {
  reasons: string[];
  text: string;
}
export interface Suggestion {
  after: string | null;
  before: string | null;
  /**
   * Question the user must answer yes to before applying.
   */
  confirmation: string | null;
  editable: boolean;
  evidence: string[];
  /**
   * Stable across re-analysis, so rejected suggestions stay rejected.
   */
  id: string;
  kind:
    | "use_job_wording"
    | "add_evidenced_skill"
    | "confirm_supported_skill"
    | "reorder_skills"
    | "reorder_bullets"
    | "rewrite_bullet"
    | "rewrite_summary"
    | "add_metric"
    | "summary_tip"
    | "gap"
    | "remove_duplicate"
    | "remove_first_person"
    | "fix_tense"
    | "rewrite_weak"
    | "dedupe_skills"
    | "tip";
  needs_confirmation: boolean;
  ops: EditOp[];
  /**
   * 1 high, 2 medium, 3 low
   */
  priority: number;
  reason: string;
  ref: Ref | null;
  skill: string | null;
  title: string;
}
export interface EditOp {
  bullet_id: string | null;
  item_id: string | null;
  new: string | null;
  old: string | null;
  op:
    | "replace_skill"
    | "add_skill"
    | "reorder_skills"
    | "reorder_bullets"
    | "set_bullet_text"
    | "set_summary_text"
    | "remove_bullet"
    | "set_skills";
  /**
   * Skills (reorder_skills) or bullet ids (reorder_bullets).
   */
  order: string[];
  origin: "user" | "ai_assisted";
  section_id: string | null;
}
/**
 * Where in the resume an issue is, so the UI can jump to it.
 */
export interface Ref {
  bullet_id: string | null;
  field: string | null;
  item_id: string | null;
  section_id: string | null;
}
export interface TailorResponse {
  match: MatchResult;
  suggestions: Suggestion[];
}
export interface MatchResult {
  keywords: KeywordMatch[];
  requirements: RequirementMatch[];
  score: Score;
}
export interface KeywordMatch {
  evidence: Evidence[];
  explanation: string;
  importance: "required" | "preferred" | "mentioned";
  /**
   * How your resume writes it.
   */
  resume_terms: string[];
  skill: string;
  status: "present" | "equivalent" | "weak" | "supported" | "missing";
  supported_by: string[];
  /**
   * The job's wording.
   */
  term: string;
}
export interface Evidence {
  ref: Ref | null;
  text: string;
  where: "experience" | "projects" | "skills" | "summary" | "education" | "certifications" | "title" | "other";
}
export interface RequirementMatch {
  category: string;
  evidence: Evidence[];
  explanation: string;
  kind: "required" | "preferred" | "responsibility";
  requirement_id: string;
  status: "met" | "partial" | "not_met" | "not_found";
  text: string;
}
export interface Score {
  band: "Excellent" | "Good" | "Fair" | "Needs work";
  categories: Category[];
  measured: boolean;
  summary: string;
  total: number;
}
export interface Category {
  criteria: Criterion[];
  id: string;
  label: string;
  max_score: number;
  score: number;
}
export interface Criterion {
  /**
   * Why this score: what was measured and what was found.
   */
  explanation: string;
  id: string;
  label: string;
  max_points: number;
  points: number;
  refs: Ref[];
  status: "good" | "fair" | "poor" | "not_measured";
  tips: string[];
}
