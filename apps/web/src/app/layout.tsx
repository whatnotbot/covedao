import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { WalletProvider } from "@/components/WalletProvider";
import { DevWallet } from "@/components/DevWallet";

export const metadata: Metadata = {
  title: "Cove",
  description:
    "Launch Bitcoin-native tokens with deterministic backing. Buy from Cove Backing, redeem back to BTC, transfer directly, or trade fixed-price P2P.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-bone antialiased">
        <WalletProvider>
          {/* Installs nothing unless the regtest-only dev wallet is enabled. */}
          <DevWallet />
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-px sm:px-6">{children}</main>
          <StatusBar />
        </WalletProvider>
      </body>
    </html>
  );
}
