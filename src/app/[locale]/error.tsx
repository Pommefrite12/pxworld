"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto max-w-xl px-5 py-24 text-center" role="alert">
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 text-ink-soft">{t("lead")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">ref: {error.digest}</p>}
      <button className="btn btn-primary mt-6" onClick={reset}>{t("retry")}</button>
    </main>
  );
}
