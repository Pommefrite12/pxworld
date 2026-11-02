"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { COMMENT_MAX, type CommentView } from "@/lib/comments";

interface Page { total: number; comments: CommentView[]; next: string | null }

const REPORT_REASONS = ["hate", "sexual", "scam", "violence", "other"] as const;

/** The comments of one parcel: first page loaded with the card (so the button can show how many there are), more on demand. */
export function useComments(code: string) {
  const [items, setItems] = useState<CommentView[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/comments?code=${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((p: Page) => { if (alive) { setItems(p.comments); setTotal(p.total); setNext(p.next); } })
      .catch(() => undefined) // no comment area is better than a broken card
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [code]);

  const more = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/comments?code=${code}&before=${encodeURIComponent(next)}`);
      if (r.ok) {
        const p = (await r.json()) as Page;
        setItems((cur) => [...cur, ...p.comments.filter((c) => !cur.some((x) => x.id === c.id))]);
        setTotal(p.total); setNext(p.next);
      }
    } finally { setLoadingMore(false); }
  }, [code, next, loadingMore]);

  /** Returns null when published, else the HTTP status of the refusal. */
  const post = useCallback(async (body: string): Promise<number | null> => {
    const r = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, body }) });
    if (!r.ok) return r.status;
    const { comment } = (await r.json()) as { comment: CommentView };
    setItems((cur) => [comment, ...cur]);
    setTotal((n) => n + 1);
    return null;
  }, [code]);

  const remove = useCallback(async (id: string) => {
    const r = await fetch("/api/comments", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (r.ok) { setItems((cur) => cur.filter((c) => c.id !== id)); setTotal((n) => Math.max(0, n - 1)); }
  }, []);

  return { items, total, hasMore: next !== null, loaded, loadingMore, more, post, remove };
}

export type CommentsState = ReturnType<typeof useComments>;

export function CommentsPanel({ code, signedIn, comments: c }: { code: string; signedIn: boolean; comments: CommentsState }) {
  const t = useTranslations("comments");
  const f = useFormatter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const status = await c.post(body);
    setBusy(false);
    if (status === null) { setText(""); return; }
    setErr(status === 429 ? t("tooFast") : status === 409 ? t("duplicate") : status === 400 ? t("invalid") : status === 401 || status === 403 ? t("signInAgain") : t("failed"));
  };

  const report = async (commentId: string, reason: string) => {
    setReporting(null);
    const r = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, reason, commentId }) });
    setNote(r.ok ? t("reported") : r.status === 429 ? t("tooFast") : t("failed"));
  };

  return (
    <section aria-label={t("title")} className="space-y-3 rounded-xl bg-paper-2 p-3" data-testid="comments">
      {signedIn ? (
        <form onSubmit={submit} className="space-y-2">
          <label className="sr-only" htmlFor={`comment-${code}`}>{t("label")}</label>
          <textarea id={`comment-${code}`} className="field w-full resize-none" rows={2} maxLength={COMMENT_MAX} value={text} placeholder={t("placeholder")}
            onChange={(e) => setText(e.target.value)} data-testid="comment-input" />
          <div className="flex items-center justify-between gap-2">
            <span className="pixel-num text-xs text-ink-faint" aria-hidden>{text.length}/{COMMENT_MAX}</span>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} data-testid="comment-send">{t("publish")}</button>
          </div>
          {err && <p role="alert" className="text-xs font-semibold text-danger">{err}</p>}
        </form>
      ) : (
        <a className="btn btn-ink btn-sm w-full" href={`/auth/sign-in?next=${encodeURIComponent(`/p/${code}`)}`} data-testid="comment-signin">{t("signIn")}</a>
      )}

      {c.loaded && c.items.length === 0 && <p className="text-sm text-ink-soft" data-testid="comments-empty">{t("empty")}</p>}
      {c.items.length > 0 && (
        <ul className="max-h-60 space-y-3 overflow-y-auto pr-1">
          {c.items.map((x) => (
            <li key={x.id} className="text-sm" data-testid="comment">
              <p className="flex items-baseline gap-2">
                <Link href={`/u/${x.author.username}`} className="font-semibold underline-offset-2 hover:underline">{x.author.username}</Link>
                <time className="text-xs text-ink-faint" dateTime={x.createdAt}>{f.dateTime(new Date(x.createdAt), { dateStyle: "medium" })}</time>
              </p>
              <p className="break-words">{x.body}</p>
              <p className="mt-0.5 flex gap-3 text-xs">
                {x.canRemove && <button type="button" className="font-semibold text-danger underline underline-offset-2" onClick={() => void c.remove(x.id)} data-testid="comment-remove">{t("remove")}</button>}
                {signedIn && !x.canRemove && (
                  <button type="button" className="font-semibold text-ink-soft underline underline-offset-2" aria-expanded={reporting === x.id} onClick={() => setReporting(reporting === x.id ? null : x.id)} data-testid="comment-report">{t("report")}</button>
                )}
              </p>
              {reporting === x.id && (
                <div role="group" aria-label={t("reportReason")} className="mt-1 grid gap-0.5 rounded-lg bg-white p-1.5 text-xs">
                  {REPORT_REASONS.map((r) => <button key={r} type="button" className="rounded-md px-2 py-1 text-left hover:bg-paper-2" onClick={() => void report(x.id, r)}>{t(`reasons.${r}`)}</button>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {c.hasMore && <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => void c.more()} disabled={c.loadingMore} data-testid="comments-more">{t("more")}</button>}
      {note && <p role="status" className="text-xs font-semibold text-mint">{note}</p>}
    </section>
  );
}
