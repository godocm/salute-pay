"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Brand } from "./brand";
export function SiteHeader() {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  const links = [
    { label: "Chains", href: "/chains" },
    { label: "About", href: "/about" },
    { label: "Developer docs", href: "/docs" },
    { label: "Pricing", href: "/pricing.html" },
  ];
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" aria-label="Salute Pay home" className="site-brand">
          <Brand />
        </Link>
        <span className="site-release">Beta · Testnet</span>
        <nav
          aria-label="Main navigation"
          className={open ? "site-nav is-open" : "site-nav"}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <a
            href="https://salutebank.com"
            className="inline-flex items-center gap-1.5"
            onClick={() => setOpen(false)}
          >
            Custodial <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <Link
            href="/app"
            className="nav-launch"
            onClick={() => setOpen(false)}
          >
            Launch app <ArrowUpRight size={16} />
          </Link>
        </nav>
        <button
          className="mobile-menu"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div>
          <Link href="/" aria-label="Salute Pay home">
            <Brand />
          </Link>
          <p>
            Open settlement.
            <br />
            Merchant-owned funds.
          </p>
        </div>
        <div className="footer-links">
          <div>
            <span>Product</span>
            <Link href="/app">Create a payment</Link>
            <Link href="/executor">Become an executor</Link>
            <a href="/pricing.html">Pricing</a>
          </div>
          <div>
            <span>Build</span>
            <Link href="/docs">Developer docs</Link>
            <Link href="/docs#deployments">Smart contracts</Link>
            <a
              href="https://github.com/godocm/salute-pay"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <ArrowUpRight size={12} />
            </a>
          </div>
          <div>
            <span>Salute</span>
            <Link href="/about">About & contact</Link>
            <a href="https://salutebank.com" target="_blank" rel="noreferrer">
              Salute Bank <ArrowUpRight size={12} />
            </a>
            <Link href="/chains">Chains</Link>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Salute Pay</span>
        <span className="testnet-label">
          <i /> Public testnet preview · Test assets only
        </span>
        <span>Protocol access is permissionless.</span>
      </div>
    </footer>
  );
}
