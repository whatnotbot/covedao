import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { WalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Cove",
  description:
    "Launch Bitcoin-native tokens with deterministic backing. Buy from Cove Backing, redeem back to BTC, transfer directly, or trade fixed-price P2P.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-gray-200 antialiased">
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
          <StatusBar />
        </WalletProvider>
      </body>
    </html>
  );
}
