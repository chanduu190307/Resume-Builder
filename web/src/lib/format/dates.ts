import type { PartialDate } from "../../types/resume.ts";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Jun 2025" or "2025". One consistent format across every template. */
export function formatDate(date: PartialDate | null | undefined): string {
  if (!date) return "";
  const month = date.month ? MONTHS[date.month - 1] : undefined;
  return month ? `${month} ${date.year}` : String(date.year);
}

/** "Jun 2025 – Aug 2025", "2020 – 2022", "Mar 2021 – Present", "2019". */
export function formatRange(
  start: PartialDate | null | undefined,
  end: PartialDate | null | undefined,
  current = false,
): string {
  const from = formatDate(start);
  const to = current ? "Present" : formatDate(end);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from || to;
}
