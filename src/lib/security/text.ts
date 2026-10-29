/** Plain-text input hygiene. Output is always rendered through React (escaped); we never store HTML. */
export function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  // strip control chars & bidi overrides, collapse whitespace
  const s = input
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩​-‏﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s.length ? s : null;
}

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
