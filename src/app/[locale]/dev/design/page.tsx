import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { isProduction } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

/**
 * DEVELOPMENT ONLY — the design system on one page: every button family in its three states (default, hover, pressed,
 * forced with the `is-hover` / `is-active` helper classes), the palette and the pixel details. 404 in production.
 */
const STATES = [["Par défaut", ""], ["Hover", "is-hover"], ["Cliqué", "is-active"]] as const;
const SWATCHES = [["Orange CTA", "#f04316"], ["Fond chaud", "#fcf9f2"], ["Bordure", "#e6dccb"], ["Hover / accent", "#e6f2ff"], ["Cliqué / actif", "#cfe6ff"], ["Texte principal", "#1f2540"]] as const;

function Row({ title, hint, render }: { title: string; hint: string; render: (state: string) => React.ReactNode }) {
  return (
    <section className="card grid items-center gap-4 p-5 md:grid-cols-[16rem_1fr]">
      <div><h2 className="text-lg font-bold">{title}</h2><p className="text-sm text-ink-soft">{hint}</p></div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {STATES.map(([label, cls]) => (
          <div key={label}><span className="chip">{label}</span><div className="mt-3 flex justify-center">{render(cls)}</div></div>
        ))}
      </div>
    </section>
  );
}

export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (isProduction()) notFound();
  return (
    <PageShell width="max-w-5xl">
      <h1 className="text-3xl font-extrabold">Système de boutons — Design UI Pixelworld</h1>
      <p className="mt-1 text-ink-soft">Boutons pixel-inspirés, modernes et premium. Page de développement : les états hover et cliqué sont forcés pour pouvoir les comparer.</p>
      <div className="mt-8 grid gap-4 pb-12">
        <Row title="CTA principal" hint="Action principale, à fort impact (ex. découverte, inscription)." render={(s) => <button className={`btn btn-primary ${s}`}>Trouvez votre place</button>} />
        <Row title="Bouton secondaire" hint="Action de soutien, non prioritaire (ex. Connexion)." render={(s) => <button className={`btn btn-secondary ${s}`}>Connexion</button>} />
        <Row title="Bouton fantôme" hint="Action discrète, dans le contexte (ex. Explorer)." render={(s) => <button className={`btn btn-ghost ${s}`}>Explorer</button>} />
        <Row title="Bouton icône" hint="Action compacte avec une icône (ex. recherche, favori, filtre)."
          render={(s) => <button aria-label="Rechercher" className={`btn btn-ghost btn-icon ${s}`}><svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg></button>} />
        <Row title="Bouton de navigation (pilule)" hint="Onglet / filtre / section (ex. Acheter une parcelle, Mes parcelles)." render={(s) => <button className={`btn btn-nav ${s}`}>Acheter une parcelle <span aria-hidden>›</span></button>} />
        <Row title="Bouton sombre" hint="Action forte et neutre (ex. Enregistrer, Importer une image)." render={(s) => <button className={`btn btn-ink ${s}`}>Enregistrer</button>} />
        <section className="card p-5">
          <h2 className="text-lg font-bold">Palette</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {SWATCHES.map(([name, hex]) => (
              <li key={hex} className="text-sm"><span className="block h-10 rounded-[6px] shadow-[inset_0_0_0_1.5px_rgb(31_37_64/0.15)]" style={{ background: hex }} /><span className="mt-1 block font-semibold">{name}</span><span className="pixel-num text-ink-soft">{hex}</span></li>
            ))}
          </ul>
          <h2 className="mt-6 text-lg font-bold">Détails pixel</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Coins en escalier (2 marches de 2 px) au lieu d&apos;arrondis.</li>
            <li>Highlight de 1 px sur le haut de chaque face, ressaut plus sombre dessous (relief).</li>
            <li>Ombre 8-bit douce <span className="pixel-num">0 2px 0 rgba(31,37,64,.12)</span> qui suit le contour en escalier.</li>
            <li>Hover clair (bleu pâle), cliqué plus profond avec un enfoncement de 2 px, focus net de 3 px.</li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
