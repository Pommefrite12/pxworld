import { setRequestLocale } from "next-intl/server";
import { Home } from "@/components/home/Home";
import { getHeaderViewer } from "@/lib/auth/session";
import { getEdition } from "@/lib/data/edition";
import { recentTraces, type Trace } from "@/lib/data/parcels";
import { toPublicEdition } from "@/lib/edition";
import { opensTheMap } from "@/lib/home";
import MapPage from "./map/page";

export const dynamic = "force-dynamic";

/**
 * `/` is the HOME page. The map lives at `/map`; but every address that was shared as `/?x=…&y=…&z=…`, `/?p=<code>`, `/?buy=1`, `/?bx=…` was a link to the map and stays one (see `lib/home.ts`).
 */
export default async function RootPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  if (opensTheMap(await props.searchParams)) return MapPage(props);

  // nothing here may break the page: without a database (or without the latest migration) the home page still stands, with less on it
  const [viewer, edition, traces] = await Promise.all([
    getHeaderViewer(),
    getEdition(),
    recentTraces(40).catch(() => [] as Trace[]),
  ]);
  return <Home viewer={viewer} edition={edition ? toPublicEdition(edition) : null} traces={traces} />;
}
