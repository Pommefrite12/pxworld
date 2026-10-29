import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { getPublicProfile } from "@/lib/data/parcels";
import { USERNAME_RE } from "@/lib/security/text";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: username, robots: { index: true } };
}

export default async function PublicProfile({ params }: { params: Promise<{ locale: string; username: string }> }) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  if (!USERNAME_RE.test(username)) notFound();
  const p = await getPublicProfile(username);
  if (!p) notFound();
  const [t, f] = await Promise.all([getTranslations("profile"), getFormatter()]);
  const region = p.country ? new Intl.DisplayNames([locale], { type: "region" }).of(p.country) : null;
  return (
    <PageShell>
      <div className="flex items-center gap-5">
        {p.has_avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/api/avatar/${p.id}`} alt="" className="h-20 w-20 rounded-full" />
          : <span className="grid h-20 w-20 place-items-center rounded-full bg-cobalt text-3xl font-bold text-white">{p.username.slice(0, 1).toUpperCase()}</span>}
        <div>
          <h1 className="text-3xl font-extrabold">{p.username}</h1>
          <p className="text-ink-soft">{[region, t("since", { date: f.dateTime(p.created_at, { dateStyle: "medium" }) })].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {p.bio && <p className="mt-4 max-w-xl">{p.bio}</p>}
      <dl className="my-6 flex gap-4">
        <div className="card px-5 py-3"><dt className="text-xs text-ink-faint">{t("parcels")}</dt><dd className="pixel-display text-2xl">{f.number(p.parcels)}</dd></div>
        <div className="card px-5 py-3"><dt className="text-xs text-ink-faint">{t("pixels")}</dt><dd className="pixel-display text-2xl">{f.number(p.pixels)}</dd></div>
      </dl>
      <h2 className="text-xl font-bold">{t("creations")}</h2>
      {p.creations.length === 0 ? <p className="mt-3 text-ink-soft">{t("none")}</p> : (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
          {p.creations.map((c) => (
            <li key={c.code}><Link href={`/p/${c.code}`} className="card checker grid aspect-square place-items-center overflow-hidden p-1.5" aria-label={c.title ?? c.code}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${c.asset_id}`} alt={c.title ?? ""} loading="lazy" className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
            </Link></li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
