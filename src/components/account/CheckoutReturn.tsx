"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type State = "waiting" | "paid" | "failed" | "slow";

/**
 * The browser's return from Stripe is NOT proof of payment. This page only polls our own order status,
 * which changes when the verified webhook (or the server-side reconciliation) has run.
 */
export function CheckoutSuccess({ orderId, token }: { orderId: string; token: string | null }) {
  const t = useTranslations("checkout");
  const [state, setState] = useState<State>("waiting");
  const [code, setCode] = useState<string | null>(null);
  /** Set for a buyer without an account: where the sign-in link went (masked), and — development only — the real address. */
  const [guest, setGuest] = useState<{ masked: string; dev: string | null } | null>(null);
  const tries = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      tries.current++;
      const qs = new URLSearchParams();
      if (token) qs.set("t", token);
      if (tries.current >= 3) qs.set("reconcile", "1");
      const r = await fetch(`/api/orders/${orderId}${qs.size ? `?${qs}` : ""}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      if (r?.status === "paid") { setCode(r.parcelCode); setGuest(r.guestEmail ? { masked: r.guestEmail, dev: r.devEmail ?? null } : null); setState("paid"); return; }
      if (r && ["failed", "expired", "canceled", "refund_required", "refunded"].includes(r.status)) { setState("failed"); return; }
      if (tries.current > 25) { setState("slow"); return; }
      setTimeout(poll, 1500);
    };
    void poll();
    return () => { alive = false; };
  }, [orderId, token]);

  const devSignIn = async () => {
    if (!guest?.dev) return;
    await fetch("/api/dev/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: guest.dev }) });
    window.location.assign("/account/parcels");
  };

  return (
    <div className="card mx-auto max-w-xl p-8 text-center" aria-live="polite" data-testid="checkout-result" data-state={state}>
      {state === "waiting" && <><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-line border-t-signal" /><h1 className="text-2xl font-extrabold">{t("confirming")}</h1><p className="mt-2 text-ink-soft">{t("confirmingLead")}</p></>}
      {state === "paid" && <><p className="text-5xl" aria-hidden>🎉</p><h1 className="mt-2 text-3xl font-extrabold">{t("paidTitle")}</h1><p className="mt-2 text-ink-soft">{t("paidLead")}</p>
        {guest && (
          <div className="mt-4 rounded-2xl bg-paper-2 p-4 text-left text-sm" data-testid="guest-notice">
            <p className="font-semibold">{t("guestTitle")}</p>
            <p className="mt-1 text-ink-soft">{t("guestLead", { email: guest.masked })}</p>
            {guest.dev && <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">{t("guestDev")} <button className="underline" onClick={devSignIn} data-testid="dev-open-account">{t("guestDevOpen")}</button></p>}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">{code && <Link href={`/p/${code}`} className="btn btn-primary" data-testid="view-parcel">{t("viewParcel")}</Link>}{!guest && <Link href="/account/parcels" className="btn btn-ghost">{t("myParcels")}</Link>}</div></>}
      {state === "slow" && <><h1 className="text-2xl font-extrabold">{t("slowTitle")}</h1><p className="mt-2 text-ink-soft">{t("slowLead")}</p>{token ? null : <Link href="/account/orders" className="btn btn-ghost mt-5">{t("orders")}</Link>}</>}
      {state === "failed" && <><h1 className="text-2xl font-extrabold">{t("failedTitle")}</h1><p className="mt-2 text-ink-soft">{t("failedLead")}</p><Link href="/map" className="btn btn-primary mt-5">{t("backToMap")}</Link></>}
    </div>
  );
}

export function CheckoutCancel({ orderId, token }: { orderId: string; token: string | null }) {
  const t = useTranslations("checkout");
  const [done, setDone] = useState(false);
  useEffect(() => {
    // The buyer walked away from Stripe: release the pixels immediately instead of waiting for the hold to lapse.
    void fetch(`/api/orders/${orderId}${token ? `?t=${token}` : ""}`, { method: "DELETE" }).finally(() => setDone(true));
  }, [orderId, token]);
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" data-testid="checkout-cancel" data-done={done}>
      <h1 className="text-2xl font-extrabold">{t("cancelTitle")}</h1>
      <p className="mt-2 text-ink-soft">{t("cancelLead")}</p>
      <Link href="/map" className="btn btn-primary mt-5">{t("backToMap")}</Link>
    </div>
  );
}
