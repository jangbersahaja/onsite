import { RegisterForm } from "@/app/register/register-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <RegisterForm token={typeof token === "string" ? token : ""} />;
}
