import type { Metadata } from "next";
import DeveloperDocs from "../../components/developer-docs";
export const metadata: Metadata = {
  title: "Developer docs · Salute Pay",
  description:
    "Integrate signed payment orders. Explore EVM, Tempo, Solana and TRON contract flows, activated testnet addresses, APIs and webhooks.",
};
export default function Page() {
  return <DeveloperDocs />;
}
