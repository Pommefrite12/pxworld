"use client";

import { useState } from "react";

/** Development stand-in for Stripe: feeds a synthetic event to the same handler as the real webhook. */
export function DevPay({ orderId, locale, token }: { orderId: string; locale: string; token: string | null }) {
  const [busy, setBusy] = useState(false);
  const prefix = locale === "en" ? "" : `/${locale}`;
  const act = async (outcome: "paid" | "expired") => {
    setBusy(true);
    await fetch("/api/dev/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, outcome, token }) });
    const t = token ? `&t=${token}` : "";
    window.location.assign(outcome === "paid" ? `${prefix}/checkout/success?order=${orderId}${t}` : `${prefix}/checkout/cancel?order=${orderId}${t}`);
  };
  return (
    <div className="flex gap-3">
      <button className="btn btn-primary" disabled={busy} onClick={() => act("paid")} data-testid="dev-pay">Simulate successful payment</button>
      <button className="btn btn-ghost" disabled={busy} onClick={() => act("expired")} data-testid="dev-cancel">Abandon</button>
    </div>
  );
}
