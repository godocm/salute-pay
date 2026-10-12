import Link from "next/link";
import { FilePlus2, Zap, SlidersHorizontal } from "lucide-react";
import { SiteHeader, SiteFooter } from "./site-shell";
export function AppShell({
  children,
  active = "merchant",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <>
      <SiteHeader />
      <div className="workspace-bar">
        <nav aria-label="Payment workspace">
          <Link
            href="/app"
            aria-current={active === "merchant" ? "page" : undefined}
          >
            <FilePlus2 size={16} /> Create payments
          </Link>
          <Link
            href="/executor"
            aria-current={active === "executor" ? "page" : undefined}
          >
            <Zap size={16} /> Executor
          </Link>
          <Link
            href="/developer"
            aria-current={active === "developer" ? "page" : undefined}
          >
            <SlidersHorizontal size={16} /> Developer settings
          </Link>
        </nav>
        <span className="workspace-test">
          <i /> Beta · Testnet workspace
        </span>
      </div>
      {children}
      <SiteFooter />
    </>
  );
}
