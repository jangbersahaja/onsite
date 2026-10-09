import TeamPage from "@/app/(management)/team/page";

export default async function OutletTeamPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  return <TeamPage key={outletId} outletId={outletId} />;
}
