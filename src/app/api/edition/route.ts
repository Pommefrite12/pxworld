import { getEdition, settleEdition } from "@/lib/data/edition";
import { toPublicEdition } from "@/lib/edition";
import { HttpError, json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

/**
 * Where the edition stands, for anybody (the home page, the countdown, the buy panel). The STATE is the database's: computed from its own
 * clock. `serverNow` is its clock at that moment: a browser counts down from it and never decides anything from its own clock.
 * Never cached (a closing must show at once).
 */
export const GET = route(async () => {
  let info = await getEdition();
  if (!info) throw new HttpError(503, "edition_unavailable");
  // somebody looks after the closing date and nothing has recorded it yet (the scheduled job runs once a day): record it, it is idempotent
  if (info.state === "closed" && info.status === "open") {
    await settleEdition();
    info = (await getEdition()) ?? info;
  }
  return json(toPublicEdition(info), { cache: "no-store" });
});
