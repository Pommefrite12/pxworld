import { ImageResponse } from "next/og";
import { CYAN, GOLD, IVORY, NIGHT, VIOLET, VIOLET_DEEP, Wordmark, pixelFont } from "@/lib/og/brand";

/** The words of the share image of the home page (and of every page that has no image of its own). */
const TEXT = {
  fr: { kicker: "ARCHIVE COLLECTIVE", a: "Dans", hl: "100 ans,", b: "que restera-t-il", c: "de nous ?", foot: "Laissez votre trace." },
  en: { kicker: "COLLECTIVE ARCHIVE", a: "In", hl: "100 years,", b: "what will remain", c: "of us?", foot: "Leave your trace." },
};

/** A row of pixels, like the product's own motif: a few of them are lit (the traces left by people). Always the same ones. */
function Pixels() {
  const cells = Array.from({ length: 22 }, (_, i) => ({ i, c: i % 7 === 3 ? CYAN : i % 11 === 5 ? GOLD : ((i * 7919) ^ (i >> 2)) % 3 === 0 ? VIOLET : VIOLET_DEEP }));
  return (
    <div style={{ display: "flex", width: 22 * 30 }}>
      {cells.map((c) => <div key={c.i} style={{ display: "flex", width: 26, height: 26, margin: 2, background: c.c }} />)}
    </div>
  );
}

/** Share image for the home page and any page without a specific one: 1200 × 630, in the language asked (`?lang=fr`, otherwise English). */
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") === "fr" ? "fr" : "en", t = TEXT[lang];
  const fonts = [{ name: "Jersey", data: await pixelFont(), weight: 400 as const, style: "normal" as const }];
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: NIGHT, padding: "52px 64px 56px", fontFamily: "Jersey", color: IVORY }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark size={52} />
          <div style={{ display: "flex", fontSize: 40, letterSpacing: 4, color: GOLD }}>{t.kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 128, lineHeight: 0.92, letterSpacing: 1 }}>
          <div style={{ display: "flex" }}><span>{t.a}&nbsp;</span><span style={{ color: GOLD }}>{t.hl}</span></div>
          <div style={{ display: "flex" }}>{t.b}</div>
          <div style={{ display: "flex" }}>{t.c}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Pixels />
          <div style={{ display: "flex", fontSize: 48, color: CYAN, whiteSpace: "nowrap" }}>{t.foot}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
