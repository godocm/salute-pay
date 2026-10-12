import PaymentPage from "../../../components/payment-page";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PaymentPage slug={slug} />;
}
