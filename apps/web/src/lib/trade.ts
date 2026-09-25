"use client";

import { verifyClientIntent } from "@crclaunch/wallets";
import { scriptOf } from "@/lib/wallets/resolve";
import type { CoveNetwork } from "@/lib/wallets/types";

/**
 * Trades shared by more than one page: filling someone's ask, and sending
 * tokens. Each takes the wallet functions it needs rather than reaching for
 * the wallet context, so a page decides what it shows while these decide
 * what is signed.
 */

export interface WalletOps {
  script: string;
  publicKey: string;
  ordinalsScript: string;
  signPsbt: (psbtBase64: string, operation: string) => Promise<string>;
  signBip322: (message: string) => Promise<string>;
  getUtxos: () => Promise<{ txid: string; vout: number }[]>;
}

/** The server's own words when it has them; the short copy otherwise. */
export function errorText(j: { error?: { message?: string; detail?: string } }): string {
  return j.error?.detail || j.error?.message || "Something went wrong.";
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(errorText(j));
  return j.data;
}

/**
 * Buy a listing: reserve it with a signed nonce, have the buyer sign the fill,
 * and hand it to the seller to countersign. Returns the fill id.
 */
export async function buyListing(
  listing: { listingId: string; amountAtoms: string; totalPriceSats: string },
  w: WalletOps,
  satPerVb: bigint | string | null,
): Promise<string> {
  const funding = await w.getUtxos();
  const tokenScript = w.ordinalsScript || w.script;
  // A signed nonce, so nobody can lock every listing for free.
  const prep = await post(`/api/v3/market/listings/${listing.listingId}/reserve/prepare`, { buyerTokenScript: tokenScript });
  const signatureB64 = await w.signBip322(prep.message);
  const { fillId } = await post(`/api/v3/market/listings/${listing.listingId}/reserve`, {
    // Bought tokens go to the ordinals address; BTC change returns to the one that paid.
    buyerTokenScript: tokenScript,
    buyerChangeScript: w.script,
    buyerFundPublicKey: w.publicKey || undefined,
    funding,
    nonceHex: prep.reserveNonce,
    signatureB64,
  });
  const built = await post(`/api/v3/market/fills/${fillId}/build`, { feeRateSatPerVb: satPerVb ?? undefined });
  // The wallet's own scripts and the price on the listing are the user's
  // facts; the server's copy of them is not trusted.
  if (!built.intent) throw new Error("server did not describe the purchase");
  verifyClientIntent(built.psbtBase64, {
    ...built.intent,
    walletScript: w.script,
    ordinalsScript: tokenScript,
    grossSats: listing.totalPriceSats,
    tokenAmountAtoms: listing.amountAtoms,
  });
  const signed = await w.signPsbt(built.psbtBase64, "P2P_BUY");
  await post(`/api/v3/market/fills/${fillId}/buyer-signature`, { signedPsbtBase64: signed });
  return fillId;
}

/** A recipient typed as an address, or (for tooling) as a raw scriptPubKey in hex. */
export function recipientScript(input: string, network: string): string {
  if (/^(0014[0-9a-f]{40}|5120[0-9a-f]{64})$/i.test(input)) return input.toLowerCase();
  return scriptOf(input, network as CoveNetwork);
}

/** Send tokens to another wallet. Returns the txid. */
export async function sendTokens(params: {
  tokenId: string;
  amountAtoms: string;
  recipient: string;
  network: string;
  walletFields: Record<string, string | undefined>;
  getUtxos: WalletOps["getUtxos"];
  signPsbt: WalletOps["signPsbt"];
  satPerVb: bigint | string | null;
}): Promise<string> {
  const funding = await params.getUtxos();
  const built = await post("/api/v3/transfer/build", {
    tokenId: params.tokenId,
    amountAtoms: params.amountAtoms,
    recipientScript: recipientScript(params.recipient, params.network),
    ...params.walletFields,
    funding,
    feeRateSatPerVb: params.satPerVb ?? undefined,
    idempotencyKey: `transfer-${params.tokenId}-${Date.now()}`,
  });
  verifyClientIntent(built.psbtBase64, built.intent);
  const signed = await params.signPsbt(built.psbtBase64, "TRANSFER");
  const sent = await post("/api/v3/transfer/submit", { sessionId: built.sessionId, signedPsbtBase64: signed });
  return sent.txid;
}
