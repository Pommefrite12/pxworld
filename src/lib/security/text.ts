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

/** A creation must have a title: a few characters at least (counted as characters, not UTF-16 units), 80 at most. */
export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const isValidTitle = (title: string): boolean => [...title.trim()].length >= TITLE_MIN;

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
