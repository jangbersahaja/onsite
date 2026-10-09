import CorrectionReviewPage from "@/app/(management)/corrections/review/page";

export default async function OutletReviewPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  return <CorrectionReviewPage key={outletId} outletId={outletId} />;
}
