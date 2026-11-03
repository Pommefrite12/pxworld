"use client";

import { tintPixels } from "./waterTint";

/** The picture as it will be shown on water: the same three blues the server serves (`lib/images/waterTint`). */
export async function tintedBlob(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d");
  if (!g) return blob;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  tintPixels(d.data, 4);
  g.putImageData(d, 0, 0);
  return await new Promise<Blob>((done) => c.toBlob((b) => done(b ?? blob), "image/png"));
}
