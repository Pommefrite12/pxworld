import { SiteHeader } from "./SiteHeader";
import { Footer } from "./Footer";
import { getHeaderViewer } from "@/lib/auth/session";

/** Standard page chrome (header + footer) for everything that is not the map. */
export async function PageShell({ children, width = "max-w-5xl" }: { children: React.ReactNode; width?: string }) {
  const viewer = await getHeaderViewer();
  return (
    <>
      <SiteHeader viewer={viewer} />
      <main id="main" className={`mx-auto w-full px-5 pt-10 ${width}`}>{children}</main>
      <Footer />
    </>
  );
}
