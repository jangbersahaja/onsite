import { revokeSession, sessionCookie } from "@/lib/auth-instance";

export async function POST(request: Request) {
  await revokeSession(request.headers);
  return Response.json(
    { signedOut: true },
    {
      headers: {
        "Set-Cookie": sessionCookie("", 0),
        "Cache-Control": "no-store",
      },
    },
  );
}
