import "server-only";
import { redirect } from "@/i18n/navigation";
import { getViewer, type Viewer } from "./session";

/** For pages: send anonymous visitors to sign-in and bring them back afterwards. */
export async function requirePageViewer(locale: string, next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect({ href: `/auth/sign-in?next=${encodeURIComponent(next)}`, locale });
  return v!;
}

export async function requirePageStaff(locale: string, min: "moderator" | "admin" = "moderator"): Promise<Viewer & { staffRole: "moderator" | "admin" }> {
  const v = await requirePageViewer(locale, "/admin");
  if (!v.staffRole || (min === "admin" && v.staffRole !== "admin")) redirect({ href: "/", locale });
  return v as Viewer & { staffRole: "moderator" | "admin" };
}
