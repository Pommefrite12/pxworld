"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { browserSupabase, devAuthUi, safeNext, supabaseEnabled } from "@/lib/auth/client";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const dest = safeNext(next);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const fail = (msg?: string) => { setError(msg ?? t("errors.generic")); setBusy(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    if (!supabaseEnabled()) {
      if (!devAuthUi()) return fail(t("errors.notConfigured"));
      // Development sign-in (never available in production builds with Supabase configured)
      const r = await fetch("/api/dev/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, username: username || undefined, role: email.startsWith("admin") ? "admin" : undefined }) });
      return r.ok ? window.location.assign(dest) : fail();
    }
    const sb = browserSupabase();
    if (mode === "sign-in") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return fail(t("errors.invalidCredentials"));
      window.location.assign(dest);
    } else if (mode === "sign-up") {
      if (password.length < 10) return fail(t("errors.weakPassword"));
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username: username || undefined }, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(dest)}` } });
      if (error) return fail(error.message.toLowerCase().includes("already") ? t("errors.exists") : t("errors.generic"));
      if (data.session) window.location.assign(dest);
      else { setInfo(t("checkEmail")); setBusy(false); }
    } else if (mode === "forgot") {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/account/reset")}` });
      setInfo(t("resetSent")); setBusy(false);
    } else {
      if (password.length < 10) return fail(t("errors.weakPassword"));
      const { error } = await sb.auth.updateUser({ password });
      if (error) return fail();
      window.location.assign("/account");
    }
  };

  const google = async () => {
    setBusy(true);
    const { error } = await browserSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(dest)}` } });
    if (error) fail();
  };

  const dev = !supabaseEnabled() && devAuthUi();
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form onSubmit={submit} className="card mx-auto w-full max-w-md space-y-4 p-6 sm:p-8" aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-2xl font-extrabold">{t(`${mode}.title`)}</h1>
      <p className="text-sm text-ink-soft">{t(`${mode}.lead`)}</p>
      {dev && <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn" data-testid="dev-auth-banner">{t("devBanner")}</p>}
      {mode !== "reset" && (
        <div><label className="label" htmlFor="au-email">{t("email")}</label><input id="au-email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="auth-email" /></div>
      )}
      {(mode === "sign-up" || dev) && mode !== "forgot" && mode !== "reset" && (
        <div><label className="label" htmlFor="au-user">{t("username")}</label><input id="au-user" className="field" autoComplete="username" pattern="[A-Za-z0-9_.\-]{3,24}" title={t("usernameHint")} value={username} onChange={(e) => setUsername(e.target.value)} /><p className="mt-1 text-xs text-ink-faint">{t("usernameHint")}</p></div>
      )}
      {mode !== "forgot" && !dev && (
        <div><label className="label" htmlFor="au-pw">{mode === "reset" ? t("newPassword") : t("password")}</label><input id="au-pw" className="field" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-in" ? 1 : 10} value={password} onChange={(e) => setPassword(e.target.value)} />{mode !== "sign-in" && <p className="mt-1 text-xs text-ink-faint">{t("passwordHint")}</p>}</div>
      )}
      {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
      {info && <p role="status" className="rounded-xl bg-mint/12 px-3 py-2 text-sm font-semibold text-[#0b7a5a]">{info}</p>}
      <button className="btn btn-primary w-full" disabled={busy} type="submit" data-testid="auth-submit">{t(`${mode}.submit`)}</button>
      {(mode === "sign-in" || mode === "sign-up") && supabaseEnabled() && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-faint"><span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" /></div>
          <button type="button" className="btn btn-ghost w-full" onClick={google} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
            {t("google")}
          </button>
        </>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {mode === "sign-in" && <><Link href={`/auth/sign-up${q}`} className="font-semibold text-cobalt underline">{t("noAccount")}</Link><Link href="/auth/forgot" className="text-ink-soft underline">{t("forgotLink")}</Link></>}
        {mode === "sign-up" && <Link href={`/auth/sign-in${q}`} className="font-semibold text-cobalt underline">{t("haveAccount")}</Link>}
        {mode === "forgot" && <Link href="/auth/sign-in" className="font-semibold text-cobalt underline">{t("backToSignIn")}</Link>}
      </div>
    </form>
  );
}
