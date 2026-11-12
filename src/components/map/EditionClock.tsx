"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { timeLeft, type PublicEdition } from "@/lib/edition";

/**
 * The countdown of the edition, on the map: days, hours, minutes and seconds left to take part. Before the opening it says the archive opens
 * soon and how long the edition will last (nothing can be counted: the 365 days start only when an administrator opens the edition, so no clock ticks); after the closing it says the edition is over.
 *
 * It counts on the SERVER's clock: the first paint (server and browser alike) is the server's own moment, then it ticks from that moment,
 * the gap with this browser's clock being measured once. The browser never decides anything from its own clock (the database does).
 */
export function EditionClock({ edition }: { edition: PublicEdition }) {
  const t = useTranslations("clock");
  const [now, setNow] = useState(() => Date.parse(edition.serverNow));
  useEffect(() => {
    if (edition.state !== "open" || !edition.closesAt) return;
    const offset = Date.parse(edition.serverNow) - Date.now();
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [edition]);

  const counting = edition.state === "open" && edition.closesAt !== null && Date.parse(edition.closesAt) > now;
  const state = counting ? "open" : edition.state === "prelaunch" ? "prelaunch" : "closed";
  const left = counting ? timeLeft(edition.closesAt!, now) : null;
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    <section aria-label={t("label")} className="card pointer-events-auto w-full max-w-[22rem] px-4 py-2.5" data-testid="map-clock" data-state={state}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{t(counting ? "eyebrowOpen" : "eyebrowOther")}</p>
      {left ? (
        <p role="timer" aria-label={t("daysAria", { n: left.d })} className="mt-0.5 font-display text-[1.3rem] font-extrabold leading-tight tabular-nums text-signal" data-testid="map-clock-time">
          {t("remaining", { d: left.d, h: two(left.h), m: two(left.m), s: two(left.s) })}
        </p>
      ) : (
        <p className="mt-0.5 font-display text-lg font-extrabold leading-tight text-ink" data-testid="map-clock-text">{t(state === "prelaunch" ? "prelaunch" : "closed")}</p>
      )}
      {state === "prelaunch" && edition.durationDays > 0 && (
        <p className="mt-0.5 text-sm text-ink-soft" data-testid="map-clock-duration">{t("prelaunchDuration", { n: edition.durationDays })}</p>
      )}
    </section>
  );
}
