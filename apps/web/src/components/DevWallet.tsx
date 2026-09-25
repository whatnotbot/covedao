"use client";

import { useEffect, useState } from "react";

/**
 * Installs a local development wallet on regtest so the product can be clicked
 * through by hand.
 *
 * `WalletProvider` reads `window.__COVE_TEST_WALLET__` and nothing else, and
 * until now only the Playwright harness ever set it — which meant there was no
 * way to use the app manually. This bridges that gap by pointing that same hook
 * at `/api/dev/wallet`, which signs with the public regtest fixture keys.
 *
 * It installs nothing unless the server confirms the dev wallet is enabled, and
 * that endpoint refuses outside regtest, outside a dev build, and without
 * COVE_DEV_WALLET=true. Pick an identity with `?wallet=alice|bob|carol`; the
 * choice is remembered so it survives navigation.
 */

const STORAGE_KEY = "cove.devWallet.identity";

interface DevIdentity {
  identity: string;
  address: string;
  script: string;
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/api/dev/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error?.message ?? "dev wallet request failed");
  return j.data as Record<string, unknown>;
}

export function DevWallet() {
  const [identity, setIdentity] = useState<DevIdentity | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("wallet");
    if (requested) window.localStorage.setItem(STORAGE_KEY, requested);
    const name = requested ?? window.localStorage.getItem(STORAGE_KEY);
    if (!name) return;

    let cancelled = false;
    void fetch(`/api/dev/wallet?identity=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        const id = j.data as DevIdentity;
        (window as unknown as Record<string, unknown>).__COVE_TEST_WALLET__ = {
          id: "dev",
          connect: async () => ({
            adapterId: "dev",
            paymentAddress: id.address,
            paymentScript: id.script,
            network: "regtest",
            capabilities: {
              psbt: true,
              bip322Simple: true,
              p2wpkh: true,
              p2tr: false,
              utxoDiscovery: true,
            },
          }),
          signPsbt: async (p: { psbtBase64: string }) =>
            (await post({ action: "signPsbt", identity: id.identity, psbtBase64: p.psbtBase64 }))
              .signedPsbtBase64 as string,
          signBip322Simple: async (p: { message: string }) =>
            (await post({ action: "signBip322", identity: id.identity, message: p.message }))
              .signatureB64 as string,
          getUtxos: async () =>
            (await post({ action: "getUtxos", identity: id.identity })).utxos as unknown,
        };
        setIdentity(id);
      })
      .catch(() => {
        /* dev wallet is off; the app behaves exactly as it does in production */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!identity) return null;

  return (
    <div className="fixed bottom-14 right-4 z-50 border border-pending/40 bg-pending/10 px-3 py-2 text-label uppercase tracking-label text-pending">
      Dev wallet · {identity.identity} · {identity.address.slice(0, 10)}…
    </div>
  );
}
