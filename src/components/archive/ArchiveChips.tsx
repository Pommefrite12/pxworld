import { useLocale, useTranslations } from "next-intl";
import { isCategory } from "@/lib/archive";

/** The category and the place of a creation, as small labels. Nothing if the creation has neither (those made before the archive). */
export function ArchiveChips({ category, placeLabel, placeCountry, className = "" }: { category: string | null; placeLabel: string | null; placeCountry: string | null; className?: string }) {
  const t = useTranslations("archive");
  const locale = useLocale();
  let country: string | null = null;
  if (placeCountry) { try { country = new Intl.DisplayNames([locale], { type: "region" }).of(placeCountry) ?? null; } catch { country = null; } }
  const place = [placeLabel, country && country !== placeLabel ? country : null].filter(Boolean).join(", ");
  if (!isCategory(category) && !place) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {isCategory(category) && <span className="chip" data-testid="archive-category">{t(`categories.${category}`)}</span>}
      {place && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft" data-testid="archive-place">
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" /></svg>{place}
        </span>
      )}
    </span>
  );
}
