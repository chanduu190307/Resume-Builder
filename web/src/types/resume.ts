/**
 * App-facing resume types. The shapes come from resume.generated.ts, which is
 * generated from the Python model - never hand-edit those shapes here.
 */
export type * from "./resume.generated.ts";
import type { Resume } from "./resume.generated.ts";

export type Section = Resume["sections"][number];
export type SectionType = Section["type"];
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;
export type ItemOf<T extends SectionType> = SectionOf<T>["items"][number];
