import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getPublicParcel } from "@/lib/data/parcels";
import { queryOne } from "@/lib/db/pool";
import { CYAN, GOLD, IVORY, NIGHT, VIOLET_DEEP, Wordmark, fitsPixelFont, pixelFont } from "@/lib/og/brand";
import { ogLang } from "@/lib/og/lang";
import { objectStore } from "@/lib/storage";

const TEXT = {
  fr: { kicker: "ARCHIVE COLLECTIVE", by: "par", illustration: "Image d'illustration", pixels: "pixels", tagline: "Dans 100 ans, que restera-t-il de nous ?", locale: "fr-FR" },
  en: { kicker: "COLLECTIVE ARCHIVE", by: "by", illustration: "Illustration image", pixels: "pixels", tagline: "In 100 years, what will remain of us?", locale: "en" },
  es: { kicker: "ARCHIVO COLECTIVO", by: "por", illustration: "Imagen ilustrativa", pixels: "píxeles", tagline: "Dentro de 100 años, ¿qué quedará de nosotros?", locale: "es-ES" },
};

/**
 * Share image (1200×630) for a trace: the creation, pixel-exact, next to its title and author, in the night palette of the site and in the
 * language of the page that announces it (`?lang=fr`, otherwise English). Set in the site's pixel font, unless the title or the author's name
 * uses letters it cannot draw: then the renderer's own font sets the whole card, so that nothing turns into empty boxes.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const lang = ogLang(new URL(req.url).searchParams.get("lang")), t = TEXT[lang];
  const p = await getPublicParcel(code, lang).catch(() => null); // an illustration's title in the language of the image (French, Spanish, English)
  if (!p) return new Response("Not found", { status: 404 });

  const BOX = 500;
  let dataUrl: string | null = null;
  if (p.creation) {
    const row = await queryOne<{ storage_path: string }>("select storage_path from public.parcel_assets where id = $1", [p.creation.asset_id]);
    const bytes = row ? await objectStore().get(row.storage_path) : null;
    if (bytes) {
      // integer upscale of the creation's own dots keeps them razor sharp (a creation may be at half-pixel precision)
      const meta = await sharp(bytes).metadata();
      const sw = meta.width ?? p.w, sh = meta.height ?? p.h;
      const kk = Math.floor(BOX / Math.max(sw, sh));
      const out = kk > 1
        ? await sharp(bytes).resize(sw * kk, sh * kk, { kernel: "nearest" }).png().toBuffer()
        : await sharp(bytes).resize({ width: BOX, height: BOX, fit: "inside", kernel: "lanczos3" }).png().toBuffer();
      dataUrl = `data:image/png;base64,${out.toString("base64")}`;
    }
  }
  const title = (p.creation?.title ?? "Pixel World").slice(0, 60), author = p.tier === "illustration" ? t.illustration : p.owner.username; // an illustration has no author
  const shown = k2(p.w, p.h, BOX);
  const pixel = fitsPixelFont(title + author);
  const fonts = pixel ? [{ name: "Jersey", data: await pixelFont(), weight: 400 as const, style: "normal" as const }] : undefined;
  const titleSize = pixel ? (title.length > 26 ? 70 : 96) : title.length > 26 ? 52 : 68;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: NIGHT, padding: 52, fontFamily: pixel ? "Jersey" : "sans-serif", color: IVORY }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 526, height: 526, background: VIOLET_DEEP, border: `4px solid ${GOLD}` }}>
          {dataUrl ? (
            <img src={dataUrl} width={shown.w} height={shown.h} alt="" />
          ) : (
            <div style={{ display: "flex", width: 300, height: 300, background: "#382050", alignItems: "center", justifyContent: "center", fontSize: 40, color: GOLD }}>Pixel World</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, marginLeft: 52 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Wordmark size={40} />
            <div style={{ display: "flex", marginTop: 14, fontSize: 28, letterSpacing: 3, color: GOLD }}>{t.kicker}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: titleSize, lineHeight: 1.0, letterSpacing: pixel ? 1 : -2 }}>{title}</div>
            <div style={{ display: "flex", fontSize: pixel ? 44 : 34, marginTop: 20, color: GOLD }}>{p.tier === "illustration" ? author : `${t.by} ${author}`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: pixel ? 32 : 26, color: "#b9aebf" }}>{p.w}×{p.h} px · {p.area.toLocaleString(t.locale).replace(/[\u202f\u00a0]/g, " ")} {t.pixels}</div>
            <div style={{ display: "flex", fontSize: pixel ? (t.tagline.length > 36 ? 30 : 38) : t.tagline.length > 36 ? 24 : 28, marginTop: 10, color: CYAN, whiteSpace: "nowrap" }}>{t.tagline}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}

function k2(w: number, h: number, box: number) {
  const k = Math.max(1, Math.floor(box / Math.max(w, h)));
  if (k > 1) return { w: w * k, h: h * k };
  const s = box / Math.max(w, h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}
