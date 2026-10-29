import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getPublicParcel } from "@/lib/data/parcels";
import { queryOne } from "@/lib/db/pool";
import { objectStore } from "@/lib/storage";

/** Share image (1200×630) for a parcel: the creation, pixel-exact, next to its title and owner. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const p = await getPublicParcel(code).catch(() => null);
  if (!p) return new Response("Not found", { status: 404 });

  const BOX = 500;
  let dataUrl: string | null = null;
  if (p.creation) {
    const row = await queryOne<{ storage_path: string }>("select storage_path from public.parcel_assets where id = $1", [p.creation.asset_id]);
    const bytes = row ? await objectStore().get(row.storage_path) : null;
    if (bytes) {
      const k = Math.max(1, Math.floor(BOX / Math.max(p.w, p.h)));
      const out = k > 1
        ? await sharp(bytes).resize(p.w * k, p.h * k, { kernel: "nearest" }).png().toBuffer() // integer upscale keeps pixels razor sharp
        : await sharp(bytes).resize({ width: BOX, height: BOX, fit: "inside", kernel: "lanczos3" }).png().toBuffer();
      dataUrl = `data:image/png;base64,${out.toString("base64")}`;
    }
  }
  const title = p.creation?.title ?? "Pixel World";
  const shown = k2(p.w, p.h, BOX);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#fbf8f2", padding: 52, fontFamily: "sans-serif", color: "#17151f" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 526, height: 526, background: "#ffffff", borderRadius: 28, border: "3px solid #e4ddcf" }}>
          {dataUrl ? (
            <img src={dataUrl} width={shown.w} height={shown.h} alt="" />
          ) : (
            <div style={{ display: "flex", width: 300, height: 300, background: "#c9dfe8", borderRadius: 20, alignItems: "center", justifyContent: "center", fontSize: 40, color: "#5a5766" }}>Pixel World</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, marginLeft: 52 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>
            pixel<span style={{ color: "#ff4d2e" }}>world</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: title.length > 26 ? 52 : 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{title.slice(0, 60)}</div>
            <div style={{ display: "flex", fontSize: 34, marginTop: 20, color: "#5a5766" }}>by {p.owner.username}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, color: "#8d8a98" }}>{p.w}×{p.h} px · {p.area.toLocaleString("en")} pixels</div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginTop: 10, color: "#ff4d2e" }}>One planet. One billion pixels. Your mark.</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}

function k2(w: number, h: number, box: number) {
  const k = Math.max(1, Math.floor(box / Math.max(w, h)));
  if (k > 1) return { w: w * k, h: h * k };
  const s = box / Math.max(w, h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}
