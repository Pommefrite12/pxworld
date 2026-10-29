"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { COUNTRY_CODES } from "@/lib/countries";

export function ProfileForm({ initial }: { initial: { username: string; country: string | null; bio: string | null; avatarId: string | null; avatarV: string } }) {
  const t = useTranslations("account.form");
  const locale = useLocale();
  const [username, setUsername] = useState(initial.username);
  const [country, setCountry] = useState(initial.country ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const sorted = [...COUNTRY_CODES].sort((a, b) => (names.of(a) ?? a).localeCompare(names.of(b) ?? b, locale));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, country, bio }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: t("saved") } : { ok: false, text: t.has(`errors.${j.error}`) ? t(`errors.${j.error}`) : t("errors.generic") });
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData(); fd.set("avatar", file);
    const r = await fetch("/api/profile", { method: "POST", body: fd });
    if (r.ok) window.location.reload(); else setMsg({ ok: false, text: t("errors.avatar") });
  };

  return (
    <form onSubmit={save} className="card space-y-4 p-6">
      <div className="flex items-center gap-4">
        {initial.avatarId
          ? <img src={`/api/avatar/${initial.avatarId}?v=${initial.avatarV}`} alt="" className="h-16 w-16 rounded-full" />
          : <span className="grid h-16 w-16 place-items-center rounded-full bg-cobalt text-2xl font-bold text-white">{initial.username.slice(0, 1).toUpperCase()}</span>}
        <label className="btn btn-ghost btn-sm cursor-pointer">{t("avatar")}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} /></label>
      </div>
      <div><label className="label" htmlFor="pf-user">{t("username")}</label><input id="pf-user" className="field" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[A-Za-z0-9_.\-]{3,24}" required /><p className="mt-1 text-xs text-ink-faint">{t("usernameHint")}</p></div>
      <div><label className="label" htmlFor="pf-country">{t("country")}</label>
        <select id="pf-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">—</option>
          {sorted.map((c) => <option key={c} value={c}>{names.of(c) ?? c}</option>)}
        </select></div>
      <div><label className="label" htmlFor="pf-bio">{t("bio")}</label><textarea id="pf-bio" className="field !min-h-24" rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} /></div>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`}>{msg.text}</p>}
      <button className="btn btn-ink" disabled={busy}>{t("save")}</button>
    </form>
  );
}
