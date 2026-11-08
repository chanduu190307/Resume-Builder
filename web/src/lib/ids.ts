/** 12-char hex ids, the same format the engine generates. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
