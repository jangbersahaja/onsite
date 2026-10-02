import { InviteAcceptanceForm } from "@/app/invite/invite-acceptance-form";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return (
    <InviteAcceptanceForm token={typeof token === "string" ? token : ""} />
  );
}
