import { getSession } from "@/lib/auth-instance";

export async function GET(request: Request) {
  const session = await getSession(request.headers);
  return Response.json(
    { user: session?.user ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
