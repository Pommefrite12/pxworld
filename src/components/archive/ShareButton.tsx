"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Shares the page with the device's own share sheet when there is one (phones), otherwise copies the link. */
export function ShareButton({ title, text, className = "btn btn-ink" }: { title: string; text: string; className?: string }) {
  const t = useTranslations("archive.page");
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = window.location.href.split("#")[0]!;
    try {
      if (typeof navigator.share === "function") { await navigator.share({ title, text, url }); return; }
    } catch { return; } // the visitor closed the share sheet
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2500); } catch { window.prompt(t("share"), url); }
  };
  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" className={className} onClick={() => void share()} data-testid="archive-share">{t("share")}</button>
      <span role="status" className="text-sm font-semibold text-mint">{done ? t("copied") : ""}</span>
    </span>
  );
}
