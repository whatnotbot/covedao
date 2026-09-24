"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";

const nav = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/market", label: "Market" },
  { href: "/activity", label: "Activity" },
  { href: "/wallet", label: "Wallet" },
];

export function Header() {
  const pathname = usePathname();
  const { connected, address, connect } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold">C</span>
          <span>Cove</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                pathname.startsWith(item.href) ? "bg-surface text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {connected ? (
            <span className="ml-1 hidden rounded-lg bg-surface px-3 py-2 text-xs text-gray-300 sm:inline" title={address}>
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
          ) : (
            <button
              onClick={() => void connect()}
              className="ml-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-bright"
            >
              Connect
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
