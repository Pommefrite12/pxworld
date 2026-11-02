import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { DevPay } from "@/components/account/DevPay";
import { stripeMockEnabled } from "@/lib/env";
import { getViewer } from "@/lib/auth/session";
import { verifyOrderToken } from "@/lib/stripe/orderToken";
import { queryOne } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

/** DEVELOPMENT ONLY — stands in for Stripe Checkout when STRIPE_MOCK=true. 404 everywhere else. */
export default async function DevCheckout({ params, searchParams }: { params: Promise<{ locale: string; orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { locale, orderId } = await params;
  const { t: token } = await searchParams;
  setRequestLocale(locale);
  if (!stripeMockEnabled() || !/^[0-9a-f-]{36}$/.test(orderId)) notFound();
  const v = await getViewer();
  const o = await queryOne<{ id: string; amount_cents: number; status: string; w: number; h: number }>(
    "select id, amount_cents, status, w, h from public.orders where id = $1 and ($2::uuid = user_id or $3::boolean)",
    [orderId, v?.user.id ?? null, verifyOrderToken(orderId, token)],
  );
  if (!o) notFound();
  return (
    <PageShell width="max-w-xl">
      <div className="card space-y-4 p-8">
        <p className="chip !bg-warn/15 !text-warn">STRIPE MOCK — development only, no real payment</p>
        <h1 className="text-2xl font-extrabold">Simulated checkout</h1>
        <p className="text-ink-soft">Order {o.id.slice(0, 8)} · {o.w}×{o.h} · {(o.amount_cents / 100).toFixed(2)} EUR · status {o.status}</p>
        <DevPay orderId={o.id} locale={locale} token={token ?? null} />
      </div>
    </PageShell>
  );
}
