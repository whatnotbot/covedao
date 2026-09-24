"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { WalletCapabilities } from "@crclaunch/wallets";

interface WalletState {
  connected: boolean;
  address: string;
  script: string;
  adapterId: string;
  network: string;
  capabilities: WalletCapabilities | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signPsbt: (psbtBase64: string, operation: string) => Promise<string>;
  signBip322: (message: string) => Promise<string>;
  getUtxos: () => Promise<{ txid: string; vout: number }[]>;
}

const WalletContext = createContext<WalletState | null>(null);

interface TestWallet {
  id: string;
  connect(): Promise<{ adapterId: string; paymentAddress: string; paymentScript: string; network: string; capabilities: WalletCapabilities }>;
  disconnect?(): Promise<void>;
  signPsbt(params: { psbtBase64: string; inputIndexes?: number[]; operation: string }): Promise<string>;
  signBip322Simple?(params: { message: string }): Promise<string>;
  getUtxos?(): Promise<{ txid: string; vout: number }[]>;
}

function getTestWallet(): TestWallet | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __COVE_TEST_WALLET__?: TestWallet }).__COVE_TEST_WALLET__ ?? null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [script, setScript] = useState("");
  const [adapterId, setAdapterId] = useState("");
  const [network, setNetwork] = useState("");
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);

  const connect = useCallback(async () => {
    const wallet = getTestWallet();
    if (!wallet) throw new Error("No wallet detected");
    const conn = await wallet.connect();
    setConnected(true);
    setAddress(conn.paymentAddress);
    setScript(conn.paymentScript);
    setAdapterId(conn.adapterId);
    setNetwork(conn.network);
    setCapabilities(conn.capabilities);
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
    setAddress("");
    setScript("");
  }, []);

  const signPsbt = useCallback(
    async (psbtBase64: string, operation: string) => {
      const wallet = getTestWallet();
      if (!wallet) throw new Error("No wallet detected");
      return wallet.signPsbt({ psbtBase64, operation });
    },
    [],
  );

  const signBip322 = useCallback(async (message: string) => {
    const wallet = getTestWallet();
    if (!wallet) throw new Error("No wallet detected");
    if (!wallet.signBip322Simple) throw new Error("Wallet does not support BIP-322");
    return wallet.signBip322Simple({ message });
  }, []);

  const getUtxos = useCallback(async () => {
    const wallet = getTestWallet();
    if (!wallet || !wallet.getUtxos) return [];
    return wallet.getUtxos();
  }, []);

  // NO auto-connect in production: the mock/demo wallet must never self-attach.
  useEffect(() => {
    // optional: auto-detect is intentionally left out of the production path.
  }, []);

  const value = useMemo(
    () => ({ connected, address, script, adapterId, network, capabilities, connect, disconnect, signPsbt, signBip322, getUtxos }),
    [connected, address, script, adapterId, network, capabilities, connect, disconnect, signPsbt, signBip322, getUtxos],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
