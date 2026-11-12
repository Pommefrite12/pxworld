"use client";

import { useTranslations } from "next-intl";
import { CATEGORIES } from "@/lib/archive";

export interface ArchiveValue { category: string; placeLabel: string; placeCountry: string }
export const EMPTY_ARCHIVE: ArchiveValue = { category: "", placeLabel: "", placeCountry: "" };

/**
 * The short form of the archive: a category (asked: the archive is sorted by it) — the same wherever a creation is made (purchase, group project,
 * new version). The place and the country are no longer asked (owner's choice, November 2026): the value still carries them, unchanged, so that a
 * creation that already has them keeps them when it is edited.
 */
export function ArchiveFields({ id, value, onChange }: { id: string; value: ArchiveValue; onChange: (v: ArchiveValue) => void }) {
  const t = useTranslations("archive");
  return (
    <fieldset className="space-y-3 rounded-2xl border border-line p-3" data-testid={`${id}-archive`}>
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-faint">{t("fields.legend")}</legend>
      <div>
        <label className="label" htmlFor={`${id}-category`}>{t("fields.category")}</label>
        <select id={`${id}-category`} className="field" required value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })} data-testid={`${id}-category`}>
          <option value="" disabled>{t("fields.categoryPlaceholder")}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
        </select>
      </div>
    </fieldset>
  );
}
