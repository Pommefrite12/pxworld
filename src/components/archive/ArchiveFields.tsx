"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CATEGORIES, PLACE_MAX } from "@/lib/archive";
import { COUNTRY_CODES } from "@/lib/countries";

export interface ArchiveValue { category: string; placeLabel: string; placeCountry: string }
export const EMPTY_ARCHIVE: ArchiveValue = { category: "", placeLabel: "", placeCountry: "" };

/**
 * The short form of the archive: a category (asked: the archive is sorted by it), the place the creation is about (optional, a text and a
 * country, never an address) — the same three fields wherever a creation is made (purchase, group project, new version).
 */
export function ArchiveFields({ id, value, onChange }: { id: string; value: ArchiveValue; onChange: (v: ArchiveValue) => void }) {
  const t = useTranslations("archive");
  const locale = useLocale();
  // the country names come from the browser's own language data (they differ from the server's): built once the page is alive, like in the profile form
  const [countries, setCountries] = useState<{ code: string; name: string }[] | null>(null);
  useEffect(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    const list = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list can only be built in the browser
    setCountries(list);
  }, [locale]);

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
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
        <div>
          <label className="label" htmlFor={`${id}-place`}>{t("fields.place")}</label>
          <input id={`${id}-place`} className="field" maxLength={PLACE_MAX} autoComplete="off" value={value.placeLabel} onChange={(e) => onChange({ ...value, placeLabel: e.target.value })} data-testid={`${id}-place`} />
          <p className="mt-1 text-xs text-ink-faint">{t("fields.placeHint")}</p>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-country`}>{t("fields.country")}</label>
          <select id={`${id}-country`} className="field" value={value.placeCountry} onChange={(e) => onChange({ ...value, placeCountry: e.target.value })} data-testid={`${id}-country`}>
            <option value="">{t("fields.countryNone")}</option>
            {countries ? countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>) : value.placeCountry && <option value={value.placeCountry}>{value.placeCountry}</option>}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
