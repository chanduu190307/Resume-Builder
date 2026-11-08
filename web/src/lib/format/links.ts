/** "https://www.linkedin.com/in/x/" -> "linkedin.com/in/x" (what is printed on the resume). */
export function displayUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Clickable target for a URL the user may have typed without a scheme. */
export function toHref(url: string): string {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
