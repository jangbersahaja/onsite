import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | string[];
    lang?: string | string[];
  }>;
}) {
  const { token, lang } = await searchParams;
  return (
    <ResetPasswordForm
      token={typeof token === "string" ? token : ""}
      lang={typeof lang === "string" ? lang : undefined}
    />
  );
}
