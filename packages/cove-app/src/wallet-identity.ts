import { spendKindOf, type SpendKind } from "@crclaunch/bitcoin";
import { AppError } from "./errors.js";

/**
 * The two addresses every ordinals wallet has.
 *
 * Cove used a single `walletScript` for both roles, which cannot work with a
 * real wallet. Xverse and Magic Eden hand out a nested-segwit PAYMENTS address
 * — which the protocol rejects as a token carrier — alongside a Taproot
 * ORDINALS address, which is where inscriptions and tokens are meant to live.
 * Using the payment address for everything meant those wallets could not hold
 * a Cove token at all.
 *
 * So: BTC is funded from payments and change returns there; token carriers are
 * created at and spent from ordinals.
 */
export interface WalletRole {
  /** scriptPubKey, hex. */
  script: string;
  /**
   * The owner's public key, hex. Required for anything but native segwit: a
   * nested-segwit input needs its redeemScript and a Taproot input needs its
   * internal key, and neither is recoverable from the script.
   */
  publicKey?: string;
}

export interface WalletIdentity {
  payments: WalletRole;
  ordinals: WalletRole;
}

export interface ResolvedRole extends WalletRole {
  kind: SpendKind;
  scriptBuffer: Buffer;
  publicKeyBuffer?: Buffer;
}

export interface ResolvedWalletIdentity {
  payments: ResolvedRole;
  ordinals: ResolvedRole;
  /** Both scripts — what "belongs to this wallet" means for balance checks. */
  scripts: string[];
}

function resolveRole(role: WalletRole, label: string): ResolvedRole {
  if (!/^[0-9a-f]+$/i.test(role.script) || role.script.length < 4) {
    throw new AppError("FUNDING_INPUT_INVALID", `${label} script is not hex`);
  }
  const scriptBuffer = Buffer.from(role.script, "hex");
  const kind = spendKindOf(scriptBuffer);
  if (kind === null) {
    throw new AppError(
      "WALLET_UNSUPPORTED",
      `${label} address type is not supported; Cove can spend native segwit, ` +
        `nested segwit and Taproot`,
    );
  }
  if (kind !== "p2wpkh" && !role.publicKey) {
    throw new AppError(
      "WALLET_UNSUPPORTED",
      `a ${kind} ${label} address needs its public key, which the wallet did not supply`,
    );
  }
  if (role.publicKey && !/^[0-9a-f]{66}$|^[0-9a-f]{64}$/i.test(role.publicKey)) {
    throw new AppError("WALLET_UNSUPPORTED", `${label} public key is not a 32 or 33-byte hex key`);
  }
  return {
    ...role,
    script: role.script.toLowerCase(),
    kind,
    scriptBuffer,
    publicKeyBuffer: role.publicKey ? Buffer.from(role.publicKey, "hex") : undefined,
  };
}

/**
 * Normalise what a client sent.
 *
 * A wallet with one address for everything — the regtest test signer, and any
 * native-segwit-only wallet — may send just `payments`, and both roles resolve
 * to it. No wallet is forced to invent a second address it does not have.
 */
export function resolveWalletIdentity(identity: WalletIdentity): ResolvedWalletIdentity {
  const payments = resolveRole(identity.payments, "payment");
  const ordinals =
    identity.ordinals.script.toLowerCase() === identity.payments.script.toLowerCase()
      ? payments
      : resolveRole(identity.ordinals, "ordinals");
  const scripts = [payments.script];
  if (ordinals.script !== payments.script) scripts.push(ordinals.script);
  return { payments, ordinals, scripts };
}

/**
 * Accept either the two-address form or a bare `walletScript`.
 *
 * The single-script form is what the test signer and the existing API send,
 * and it stays valid: both roles become that one address.
 */
export function walletIdentityFrom(input: {
  walletScript?: string;
  walletPublicKey?: string;
  ordinalsScript?: string;
  ordinalsPublicKey?: string;
}): WalletIdentity {
  const paymentsScript = input.walletScript ?? "";
  return {
    payments: { script: paymentsScript, publicKey: input.walletPublicKey },
    ordinals: {
      script: input.ordinalsScript || paymentsScript,
      publicKey: input.ordinalsScript ? input.ordinalsPublicKey : input.walletPublicKey,
    },
  };
}
