import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

type AuthMethod = "GET" | "POST";

async function handleAuth(request: Request, method: AuthMethod) {
  try {
    const handlers = toNextJsHandler(getAuth());
    return handlers[method](request);
  } catch {
    return Response.json(
      {
        error:
          "Authentication is not configured. Check server environment variables.",
      },
      { status: 503 },
    );
  }
}

export const GET = (request: Request) => handleAuth(request, "GET");
export const POST = (request: Request) => handleAuth(request, "POST");
