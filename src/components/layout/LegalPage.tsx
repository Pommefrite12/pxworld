import { getFormatter, getTranslations } from "next-intl/server";
import { PageShell } from "./PageShell";
import { operator } from "@/lib/legal";

interface Section { h: string; p?: string[]; ul?: string[] }

/** Renders a text page from messages (pages.<key>): headings, paragraphs and bullet lists. */
export async function LegalPage({ k, children }: { k: "rules" | "terms" | "privacy" | "credits" | "contact"; children?: React.ReactNode }) {
  const t = await getTranslations("pages");
  const f = await getFormatter();
  const op = operator();
  const vars = { operatorName: op.name, operatorAddress: op.address, operatorEmail: op.email, operatorRegistration: op.registration, operatorVat: op.vat, operatorHosts: op.host };
  const sections = (t.has(`${k}.sections`) ? (t.raw(`${k}.sections`) as Section[]) : []);
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, key: string) => (vars as Record<string, string>)[key] ?? `{${key}}`);
  return (
    <PageShell width="max-w-3xl">
      <h1 className="text-4xl font-extrabold">{t(`${k}.title`)}</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-soft">{t(`${k}.intro`)}</p>
      <div className="prose-pw mt-6">
        {sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.p?.map((p) => <p key={p} className="mt-2">{fill(p)}</p>)}
            {s.ul && <ul>{s.ul.map((li) => <li key={li}>{fill(li)}</li>)}</ul>}
          </section>
        ))}
        {children}
      </div>
      {k !== "contact" && k !== "credits" && <p className="mt-10 text-xs text-ink-faint">{t("updated", { date: f.dateTime(new Date("2026-10-29"), { dateStyle: "long" }) })}</p>}
    </PageShell>
  );
}
