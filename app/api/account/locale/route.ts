import { user } from "@/db/schema";
import { getSession } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { localeCookie, locales } from "@/lib/i18n/config";
import { eq } from "drizzle-orm";
import { z } from "zod";

const localeSchema = z.object({ locale: z.enum(locales) }).strict();

export async function PATCH(request: Request) {
  const session = await getSession(request.headers);
  if (!session) {
    return Response.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = localeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Choose a supported language.", code: "invalid_locale" },
      { status: 400 },
    );
  }

  const { locale } = parsed.data;
  await getDb()
    .update(user)
    .set({ locale, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  return Response.json(
    { locale },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": localeCookie(locale),
      },
    },
  );
}
