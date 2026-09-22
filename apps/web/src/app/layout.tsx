import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { WalletProvider } from "@/components/WalletProvider";
import { ModeBanner } from "@/components/ModeBanner";

export const metadata: Metadata = {
  title: "CRC Launch",
  description:
    "Launch CRC-20 tokens with a progressive fair mint, then trade them on a non-custodial marketplace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-gray-200 antialiased">
        <WalletProvider>
          <ModeBanner />
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
          <StatusBar />
        </WalletProvider>
      </body>
    </html>
  );
}
