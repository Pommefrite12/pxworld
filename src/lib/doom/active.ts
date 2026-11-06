import { parseEnd, previewEnd } from "./clock";
import { resolvePreview } from "./preview";

/**
 * Is the old countdown story on for this page load? (A configured end date, a default simulation, or `?preview=…` in the address.)
 * The map engine asks once, when it starts: while the story is on, the map keeps the light palette its corrupted land was drawn for.
 * Both go together when the story is removed from the site.
 */
export function storyIsOn(): boolean {
  try {
    const preview = resolvePreview(new URLSearchParams(window.location.search).get("preview"), sessionStorage.getItem("pw-doom-preview"), (process.env.NEXT_PUBLIC_STORY_PREVIEW ?? "").trim());
    if (preview && preview.toLowerCase() !== "off" && previewEnd(preview, Date.now()) !== null) return true;
  } catch { /* no storage: only the configured date counts */ }
  return parseEnd(process.env.NEXT_PUBLIC_WORLD_END_AT) !== null;
}
