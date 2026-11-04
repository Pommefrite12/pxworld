"use client";

import { useState } from "react";

/** Development stand-in for Stripe: feeds a synthetic event to the same handler as the real webhook. */
export function DevPay({ orderId, locale, contribution = false }: { orderId: string; locale: string; contribution?: boolean }) {
  const [busy, setBusy] = useState(false);
  const prefix = locale === "en" ? "" : `/${locale}`;
  const act = async (outcome: "paid" | "expired") => {
    setBusy(true);
    await fetch("/api/dev/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, outcome }) });
    const q = contribution ? "contribution" : "order";
    window.location.assign(outcome === "paid" ? `${prefix}/checkout/success?${q}=${orderId}` : `${prefix}/checkout/cancel?${q}=${orderId}`);
  };
  return (
    <div className="flex gap-3">
      <button className="btn btn-primary" disabled={busy} onClick={() => act("paid")} data-testid="dev-pay">Simulate successful payment</button>
      <button className="btn btn-ghost" disabled={busy} onClick={() => act("expired")} data-testid="dev-cancel">Abandon</button>
    </div>
  );
}
