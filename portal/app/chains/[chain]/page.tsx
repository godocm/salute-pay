import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chainPages, chainPage } from "../../../lib/chain-pages";
import { ChainPage } from "../../../components/chain-page";
export const dynamicParams = false;
export function generateStaticParams() {
  return chainPages.map((c) => ({ chain: c.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ chain: string }>;
}): Promise<Metadata> {
  const c = chainPage((await params).chain);
  return c
    ? { title: `${c.name} payments · Salute Pay`, description: c.intro }
    : {};
}
export default async function Page({
  params,
}: {
  params: Promise<{ chain: string }>;
}) {
  const c = chainPage((await params).chain);
  if (!c) notFound();
  return <ChainPage chain={c} />;
}
