"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, locales, type Locale } from "@/i18n/routing";
import { Logo } from "@/components/ui/Logo";
import { signOut } from "@/lib/auth/client";
import { DoomChip, DoomTicker } from "@/components/doom/Doom";
import { useDoom } from "@/components/doom/useDoom";

export interface HeaderViewer { username: string; avatarId: string | null; staffRole: "moderator" | "admin" | null }

function LocaleSwitch() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    // The visible part is a pixel button; the real <select> is an invisible layer over the WHOLE button, so a click anywhere
    // on it opens the native list of languages (a small select inside the padding only opened when hit exactly).
    <label className="btn btn-ghost btn-sm relative !gap-1 !pl-3 !pr-2">
      <span aria-hidden className="text-sm font-bold">{locale.toUpperCase()}</span>
      <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
      <select value={locale} onChange={(e) => router.replace(pathname + (typeof window !== "undefined" ? window.location.search : ""), { locale: e.target.value as Locale })}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" aria-label={t("language")} data-testid="locale-switch">
        {locales.map((l) => <option key={l} value={l}>{localeNames[l]}</option>)}
      </select>
    </label>
  );
}

function AccountMenu({ viewer }: { viewer: HeaderViewer }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, []);
  const item = "block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-sky";
  return (
    <div ref={ref} className="relative">
      <button className="btn btn-ghost btn-sm !gap-2 !pl-1.5 !pr-3" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="account-menu">
        {viewer.avatarId
          ? <img src={`/api/avatar/${viewer.avatarId}`} alt="" className="h-7 w-7 rounded-full" />
          : <span className="grid h-7 w-7 place-items-center rounded-full bg-cobalt text-xs font-bold text-white">{viewer.username.slice(0, 1).toUpperCase()}</span>}
        <span className="hidden max-w-28 truncate sm:inline">{viewer.username}</span>
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-11 z-50 w-52 p-1.5">
          <Link role="menuitem" className={item} href="/account/parcels" onClick={() => setOpen(false)}>{t("myParcels")}</Link>
          <Link role="menuitem" className={item} href="/account/orders" onClick={() => setOpen(false)}>{t("orders")}</Link>
          <Link role="menuitem" className={item} href="/account" onClick={() => setOpen(false)}>{t("profile")}</Link>
          {viewer.staffRole && <Link role="menuitem" className={item} href="/admin" onClick={() => setOpen(false)}>{t("admin")}</Link>}
          <button role="menuitem" className={`${item} w-full text-left text-danger`} onClick={async () => { await signOut(); window.location.assign("/"); }}>{t("signOut")}</button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader({ viewer, center, cta, className = "" }: { viewer: HeaderViewer | null; center?: React.ReactNode; cta?: React.ReactNode; className?: string }) {
  const t = useTranslations("nav");
  const doom = useDoom(); // the "100 days" story: a strip above the header, "D-87" next to the logo, a coloured line under it — all absent while it is off
  return (
    <>
    <DoomTicker />
    <header className={`relative z-40 border-b border-line bg-paper/95 backdrop-blur ${doom ? "doom-header" : ""} ${className}`}>
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-5">
        <Link href="/" aria-label={t("home")} className="shrink-0"><Logo /></Link>
        <DoomChip />
        <div className="mx-auto hidden w-full max-w-md md:block">{center}</div>
        <nav className="ml-auto flex items-center gap-1.5 sm:gap-2" aria-label={t("main")}>
          <Link href="/discover" className="btn btn-nav btn-sm hidden sm:inline-flex">{t("discover")} <span aria-hidden>›</span></Link>
          {cta}
          <LocaleSwitch />
          {viewer ? <AccountMenu viewer={viewer} /> : <Link href="/auth/sign-in" className="btn btn-secondary btn-sm" data-testid="sign-in-link">{t("signIn")}</Link>}
        </nav>
      </div>
      {center && <div className="px-3 pb-2 md:hidden">{center}</div>}
    </header>
    </>
  );
}
