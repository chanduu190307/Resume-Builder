/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: shared/schema/analysis.schema.json (from engine/src/resume_engine/analysis/models.py).
 * Regenerate: npm run gen:types
 */

export interface AnalysisResult {
  /**
   * Plain text read back from the exported PDF.
   */
  ats_text: string | null;
  career_level: "early" | "experienced";
  career_level_reason: string;
  issues: Issue[];
  parsing: Score;
  quality: Score;
  stats: Stats;
}
export interface Issue {
  affects_score: boolean;
  category: string;
  id: string;
  message: string;
  ref: Ref | null;
  severity: "error" | "warning" | "info";
  suggestion: string | null;
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
export interface Stats {
  bullets: number;
  experience_months: number;
  quantified_bullets: number;
  roles: number;
  words: number;
}
