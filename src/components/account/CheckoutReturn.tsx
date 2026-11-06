"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type State = "waiting" | "paid" | "failed" | "slow";

/**
 * The browser's return from Stripe is NOT proof of payment. This page only polls our own order status,
 * which changes when the verified webhook (or the server-side reconciliation) has run.
 */
export function CheckoutSuccess({ orderId }: { orderId: string }) {
  const t = useTranslations("checkout");
  const [state, setState] = useState<State>("waiting");
  const [code, setCode] = useState<string | null>(null);
  const tries = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      tries.current++;
      const r = await fetch(`/api/orders/${orderId}${tries.current >= 3 ? "?reconcile=1" : ""}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      if (r?.status === "paid") { setCode(r.parcelCode); setState("paid"); return; }
      if (r && ["failed", "expired", "canceled", "refund_required", "refunded"].includes(r.status)) { setState("failed"); return; }
      if (tries.current > 25) { setState("slow"); return; }
      setTimeout(poll, 1500);
    };
    void poll();
    return () => { alive = false; };
  }, [orderId]);

  return (
    <div className="card mx-auto max-w-xl p-8 text-center" aria-live="polite" data-testid="checkout-result" data-state={state}>
      {state === "waiting" && <><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-line border-t-signal" /><h1 className="text-2xl font-extrabold">{t("confirming")}</h1><p className="mt-2 text-ink-soft">{t("confirmingLead")}</p></>}
      {state === "paid" && <><p className="text-5xl" aria-hidden>🎉</p><h1 className="mt-2 text-3xl font-extrabold">{t("paidTitle")}</h1><p className="mt-2 text-ink-soft">{t("paidLead")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">{code && <Link href={`/archive/${code}`} className="btn btn-primary" data-testid="view-parcel">{t("viewParcel")}</Link>}<Link href="/account/parcels" className="btn btn-ghost">{t("myParcels")}</Link></div></>}
      {state === "slow" && <><h1 className="text-2xl font-extrabold">{t("slowTitle")}</h1><p className="mt-2 text-ink-soft">{t("slowLead")}</p><Link href="/account/orders" className="btn btn-ghost mt-5">{t("orders")}</Link></>}
      {state === "failed" && <><h1 className="text-2xl font-extrabold">{t("failedTitle")}</h1><p className="mt-2 text-ink-soft">{t("failedLead")}</p><Link href="/map" className="btn btn-primary mt-5">{t("backToMap")}</Link></>}
    </div>
  );
}

/** The same for a contribution to a group project: it only polls our own status, which changes when the verified webhook has run. */
export function ContributionSuccess({ contributionId }: { contributionId: string }) {
  const t = useTranslations("checkout");
  const [state, setState] = useState<State>("waiting");
  const [project, setProject] = useState<{ code: string; status: string } | null>(null);
  const tries = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      tries.current++;
      const r = await fetch(`/api/contributions/${contributionId}${tries.current >= 3 ? "?reconcile=1" : ""}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      if (r?.status === "paid" || r?.status === "disputed") { setProject({ code: r.projectCode, status: r.projectStatus }); setState("paid"); return; }
      if (r && ["expired", "canceled", "refund_required", "refunded", "dispute_lost"].includes(r.status)) { setProject({ code: r.projectCode, status: r.projectStatus }); setState("failed"); return; }
      if (tries.current > 25) { setState("slow"); return; }
      setTimeout(poll, 1500);
    };
    void poll();
    return () => { alive = false; };
  }, [contributionId]);

  return (
    <div className="card mx-auto max-w-xl p-8 text-center" aria-live="polite" data-testid="contribution-result" data-state={state}>
      {state === "waiting" && <><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-line border-t-signal" /><h1 className="text-2xl font-extrabold">{t("confirming")}</h1></>}
      {state === "paid" && <><p className="text-5xl" aria-hidden>🎉</p><h1 className="mt-2 text-3xl font-extrabold">{t("contributionPaidTitle")}</h1>
        <p className="mt-2 text-ink-soft">{project?.status === "funded" ? t("contributionFunded") : t("contributionPaidLead")}</p>
        {project && <div className="mt-6 flex flex-wrap justify-center gap-3"><Link href={`/projects/${project.code}`} className="btn btn-primary" data-testid="view-project">{t("viewProject")}</Link><Link href="/projects" className="btn btn-ghost">{t("allProjects")}</Link></div>}</>}
      {state === "slow" && <><h1 className="text-2xl font-extrabold">{t("slowTitle")}</h1><p className="mt-2 text-ink-soft">{t("contributionSlowLead")}</p><Link href="/projects" className="btn btn-ghost mt-5">{t("allProjects")}</Link></>}
      {state === "failed" && <><h1 className="text-2xl font-extrabold">{t("contributionFailedTitle")}</h1><p className="mt-2 text-ink-soft">{t("contributionFailedLead")}</p>
        <Link href={project ? `/projects/${project.code}` : "/projects"} className="btn btn-primary mt-5">{t("viewProject")}</Link></>}
    </div>
  );
}

export function ContributionCancel({ contributionId }: { contributionId: string }) {
  const t = useTranslations("checkout");
  const [done, setDone] = useState(false);
  useEffect(() => {
    // The contributor walked away from the payment page: give their share back at once instead of waiting for the hold to lapse.
    void fetch(`/api/contributions/${contributionId}`, { method: "DELETE" }).finally(() => setDone(true));
  }, [contributionId]);
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" data-testid="contribution-cancel" data-done={done}>
      <h1 className="text-2xl font-extrabold">{t("cancelTitle")}</h1>
      <p className="mt-2 text-ink-soft">{t("contributionCancelLead")}</p>
      <Link href="/projects" className="btn btn-primary mt-5">{t("allProjects")}</Link>
    </div>
  );
}

export function CheckoutCancel({ orderId }: { orderId: string }) {
  const t = useTranslations("checkout");
  const [done, setDone] = useState(false);
  useEffect(() => {
    // The buyer walked away from Stripe: release the pixels immediately instead of waiting for the hold to lapse.
    void fetch(`/api/orders/${orderId}`, { method: "DELETE" }).finally(() => setDone(true));
  }, [orderId]);
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" data-testid="checkout-cancel" data-done={done}>
      <h1 className="text-2xl font-extrabold">{t("cancelTitle")}</h1>
      <p className="mt-2 text-ink-soft">{t("cancelLead")}</p>
      <Link href="/map" className="btn btn-primary mt-5">{t("backToMap")}</Link>
    </div>
  );
}
