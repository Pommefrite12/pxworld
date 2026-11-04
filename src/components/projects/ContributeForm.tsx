"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { contributionProblem, parseAmountToCents, quickAmounts, MIN_CARD_CENTS, type ContributionProblem } from "@/lib/campaign";
import { formatMoney } from "@/lib/grid/pricing";

/**
 * "Chip in": pick an amount (a quick one, the exact rest, or any amount), then go to the payment page. The rules shown here are the
 * database's, applied in advance for comfort: the database decides, and its answer is shown if it disagrees (somebody else just paid).
 */
export function ContributeForm({ projectId, currency, minCents, remainingCents, signedIn, signInHref }: {
  projectId: string; currency: string; minCents: number; remainingCents: number; signedIn: boolean; signInHref: string;
}) {
  const t = useTranslations("projects.form");
  const te = useTranslations("projects.errors");
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, locale, currency);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bounds = useMemo(() => ({ remaining: remainingCents, min: minCents }), [remainingCents, minCents]);
  const { amounts, rest } = useMemo(() => quickAmounts(bounds), [bounds]);
  const cents = parseAmountToCents(text);
  const problem: ContributionProblem | null = text.trim() === "" ? null : cents === null ? "invalid" : contributionProblem(cents, bounds);
  const ready = cents !== null && problem === null;
  const problemText = problem && te(problem, { remaining: money(remainingCents), min: money(minCents), dust: money(MIN_CARD_CENTS) });

  if (remainingCents < 1) return <p className="rounded-[8px] bg-paper-2 px-3 py-2 text-sm font-semibold text-ink-soft" data-testid="contribute-full">{t("full")}</p>;
  if (!signedIn) return <a href={signInHref} className="btn btn-primary w-full" data-testid="contribute-signin">{t("signIn")}</a>;

  const go = async () => {
    if (!ready || cents === null) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/campaigns/${projectId}/contribute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: cents, locale }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { window.location.assign(j.url); return; }
      const code = String(j.error ?? (r.status === 401 ? "unauthenticated" : "internal_error"));
      if (code === "unauthenticated") { window.location.assign(signInHref); return; }
      setError(te.has(code) ? te(code, { remaining: money(remainingCents), min: money(minCents), dust: money(MIN_CARD_CENTS) }) : `${te("generic")} (${code})`);
    } catch { setError(te("network")); }
    setBusy(false);
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void go(); }} data-testid="contribute-form">
      <fieldset>
        <legend className="label">{t("quick")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {amounts.map((a) => (
            <button key={a} type="button" aria-pressed={cents === a} onClick={() => setText(String(a / 100))} data-testid={`quick-${a / 100}`} className="btn btn-secondary btn-sm">{money(a)}</button>
          ))}
          {rest !== null && <button type="button" aria-pressed={cents === rest} onClick={() => setText((rest / 100).toFixed(2))} data-testid="quick-rest" className="btn btn-secondary btn-sm">{t("rest", { amount: money(rest) })}</button>}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="ct-amount">{t("other", { currency: currency.toUpperCase() })}</label>
        <input id="ct-amount" className="field pixel-num" inputMode="decimal" autoComplete="off" placeholder="25" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={problem !== null} aria-describedby="ct-hint" data-testid="contribute-amount" />
        <p id="ct-hint" className="mt-1 text-xs text-ink-faint">{t("hint", { min: money(minCents), remaining: money(remainingCents) })}</p>
      </div>
      {problemText && <p role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" data-testid="contribute-problem">{problemText}</p>}
      {error && <p role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" data-testid="contribute-error">{error}</p>}
      <button className="btn btn-primary w-full" type="submit" disabled={!ready || busy} data-testid="contribute-submit">
        {busy ? t("redirecting") : ready && cents !== null ? t("submit", { amount: money(cents) }) : t("submitEmpty")}
      </button>
      <p className="text-xs text-ink-faint">{t("anonymous")} {t("refund")} {t("secure")}</p>
    </form>
  );
}
