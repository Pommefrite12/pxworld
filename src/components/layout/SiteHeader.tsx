"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, locales, type Locale } from "@/i18n/routing";
import { Logo } from "@/components/ui/Logo";
import { signOut } from "@/lib/auth/client";
import { DoomTicker } from "@/components/doom/Doom";
import { useDoom } from "@/components/doom/useDoom";

export interface HeaderViewer { username: string; avatarId: string | null; staffRole: "moderator" | "admin" | null }

function LocaleSwitch() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen((was) => { if (was) button.current?.focus(); return false; }); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, []);
  // opening puts the focus on the current language, so that the arrows, Enter and Escape work at once
  useEffect(() => { if (open) ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }, [open]);
  const choose = (l: Locale) => {
    setOpen(false);
    if (l !== locale) router.replace(pathname + window.location.search, { locale: l });
  };
  const move = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) { e.preventDefault(); items[to]?.focus(); }
  };
  return (
    <div ref={ref} className="relative">
      <button ref={button} type="button" className="btn btn-ghost btn-sm !gap-1 !pl-3 !pr-2" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }} data-testid="locale-switch">
        {/* the accessible name must CONTAIN the visible text ("EN": WCAG 2.5.3, label in name): "EN, Language: English" */}
        <span className="text-sm font-bold">{locale.toUpperCase()}</span>
        <span className="sr-only">, {t("language")}: {localeNames[locale]}</span>
        <svg aria-hidden viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label={t("language")} className="card absolute right-0 top-11 z-50 w-44 p-1.5" onKeyDown={move}>
          {locales.map((l) => (
            <button key={l} type="button" role="menuitemradio" aria-checked={l === locale} lang={l} onClick={() => choose(l)} data-testid={`locale-option-${l}`}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-sky focus-visible:bg-sky focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt ${l === locale ? "bg-paper-2" : ""}`}>
              <span>{localeNames[l]}</span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="pixel-num text-xs text-ink-faint">{l.toUpperCase()}</span>
                {l === locale && <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-signal" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const doom = useDoom(); // the "100 days" story: a strip above the header, a coloured line under it — all absent while it is off
  return (
    <>
    <DoomTicker />
    <header className={`relative z-40 border-b border-line bg-paper/95 backdrop-blur ${doom ? "doom-header" : ""} ${className}`}>
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-1.5 px-2.5 min-[360px]:gap-2 min-[360px]:px-3 sm:gap-4 sm:px-5">
        {/* on a phone the row (logo, call to action, language, account) is tight, above all in French: below 440 px the name gives way to the globe */}
        <Link href="/" aria-label={t("home")} className="shrink-0"><Logo wordClassName="max-[439px]:hidden" /></Link>
        <div className="mx-auto hidden w-full max-w-md md:block">{center}</div>
        <nav className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2" aria-label={t("main")}>
          <Link href="/discover" className="btn btn-nav btn-sm hidden sm:inline-flex">{t("discover")} <span aria-hidden>›</span></Link>
          {cta}
          <LocaleSwitch />
          {viewer ? <AccountMenu viewer={viewer} /> : <Link href="/auth/sign-in" className="btn btn-secondary btn-sm max-sm:!px-2.5" data-testid="sign-in-link" aria-label={t("signIn")}>
            {/* a person on a phone (the words come back from 640 px), with the words for screen readers */}
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 sm:hidden" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg>
            <span className="max-sm:sr-only">{t("signIn")}</span>
          </Link>}
        </nav>
      </div>
      {center && <div className="px-3 pb-2 md:hidden">{center}</div>}
    </header>
    </>
  );
}
