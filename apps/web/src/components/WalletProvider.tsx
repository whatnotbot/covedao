"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface WalletState {
  connected: boolean;
  address: string;
  adapterId: string;
  network: string;
  connect: () => Promise<string>;
  disconnect: () => void;
  signPsbt: (psbt: string) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

function mockAddress(): string {
  if (typeof window === "undefined") return "bc1qm0ck000000000000000000000000000000000000000000000000";
  const stored = window.localStorage.getItem("crc:mock:address");
  if (stored) return stored;
  const addr = `bc1qm0ck${Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
  window.localStorage.setItem("crc:mock:address", addr);
  return addr;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string>("");

  const connect = useCallback(async () => {
    const addr = mockAddress();
    setAddress(addr);
    setConnected(true);
    return addr;
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
  }, []);

  const signPsbt = useCallback(
    async (psbt: string) => {
      if (!connected || !address) throw new Error("Wallet not connected.");
      // Mock signature marker (never real crypto). Browser wallets would
      // produce a real signature here via their injected adapter.
      return `${psbt}\nMOCK-SIGNED-BY:${address}`;
    },
    [connected, address],
  );

  // Auto-connect a mock wallet so mock-mode flows work without a real wallet.
  useEffect(() => {
    void connect();
  }, [connect]);

  const value = useMemo(
    () => ({ connected, address, adapterId: "mock", network: "mock", connect, disconnect, signPsbt }),
    [connected, address, connect, disconnect, signPsbt],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
