import TimesheetsPage from "@/app/(management)/timesheets/page";

export default async function OutletTimesheetsPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  return <TimesheetsPage key={outletId} outletId={outletId} />;
}
