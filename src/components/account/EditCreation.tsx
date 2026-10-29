"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ParcelEditor, type ParcelEditorHandle } from "@/components/editor/ParcelEditor";

export function EditCreation({ code, w, h, current }: { code: string; w: number; h: number; current: { assetId: string | null; title: string | null; description: string | null; link: string | null } }) {
  const t = useTranslations("account.edit");
  const tb = useTranslations("buy");
  const router = useRouter();
  const editor = useRef<ParcelEditorHandle>(null);
  const [has, setHas] = useState(false);
  const [title, setTitle] = useState(current.title ?? "");
  const [description, setDescription] = useState(current.description ?? "");
  const [link, setLink] = useState(current.link ?? "");
  const [commercial, setCommercial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onChange = useCallback((v: boolean) => setHas(v), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const blob = await editor.current!.exportPng();
    const fd = new FormData();
    fd.set("image", new File([blob], "creation.png", { type: "image/png" }));
    fd.set("title", title); fd.set("description", description); fd.set("link", link); fd.set("commercial", String(commercial));
    const r = await fetch(`/api/parcels/${code}/creation`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: t("submitted") }); router.refresh(); }
    else setMsg({ ok: false, text: tb.has(`errors.${j.error}`) ? tb(`errors.${j.error}`) : tb("errors.generic") });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <ParcelEditor ref={editor} w={w} h={h} onChange={onChange} initialImageUrl={current.assetId ? `/api/assets/${current.assetId}` : null} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="ec-title">{tb("fields.title")}</label><input id="ec-title" className="field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="label" htmlFor="ec-link">{tb("fields.link")}</label><input id="ec-link" className="field" type="url" maxLength={500} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="ec-desc">{tb("fields.description")}</label><textarea id="ec-desc" className="field !min-h-20" maxLength={280} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /><span>{tb("fields.commercial")}</span></label>
      </div>
      <p className="text-sm text-ink-soft">{t("moderationNote")}</p>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`} data-testid="edit-msg">{msg.text}</p>}
      <button className="btn btn-primary" disabled={busy || !has} data-testid="edit-submit">{busy ? "…" : t("submit")}</button>
    </form>
  );
}
