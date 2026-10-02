import { authSchema } from "@/db/schema";
import { getDb } from "@/lib/db-client";
import { storeResetPasswordLink } from "@/lib/reset-password-delivery";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

function createAuth(allowSignUp: boolean) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters.",
    );
  }

  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return betterAuth({
    appName: "Shiftline",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      disableSignUp: !allowSignUp,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ url }, request) => {
        const requestId = request?.headers.get("x-shiftline-reset-delivery");
        if (requestId) storeResetPasswordLink(requestId, url);
      },
    },
    user: {
      additionalFields: {
        globalRole: {
          type: ["member", "admin"],
          required: true,
          defaultValue: "member",
          input: false,
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as typeof globalThis & {
  shiftlineAuth?: AuthInstance;
  shiftlineBootstrapAuth?: AuthInstance;
};

export function getAuth(options: { allowSignUp?: boolean } = {}) {
  const allowSignUp = options.allowSignUp === true;
  const cached = allowSignUp
    ? globalForAuth.shiftlineBootstrapAuth
    : globalForAuth.shiftlineAuth;
  if (cached) return cached;
  const auth = createAuth(allowSignUp);

  if (allowSignUp) globalForAuth.shiftlineBootstrapAuth = auth;
  else globalForAuth.shiftlineAuth = auth;
  return auth;
}
