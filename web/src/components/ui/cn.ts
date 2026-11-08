import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts so later classes win
 * (e.g. a base "w-full h-9" overridden by "w-32 h-8").
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(" "));
}
