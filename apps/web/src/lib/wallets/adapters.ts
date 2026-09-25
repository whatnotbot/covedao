"use client";

import * as bitcoin from "bitcoinjs-lib";
import { Psbt } from "bitcoinjs-lib";
import * as unisat from "@ordzaar/ordit-sdk/unisat";
import * as xverse from "@ordzaar/ordit-sdk/xverse";
import * as magiceden from "@ordzaar/ordit-sdk/magiceden";
import * as leather from "@ordzaar/ordit-sdk/leather";
import { LeatherAddressType } from "@ordzaar/ordit-sdk/leather";
import * as okx from "@ordzaar/ordit-sdk/okx";
import * as phantom from "@ordzaar/ordit-sdk/phantom";
import * as oyl from "@ordzaar/ordit-sdk/oyl";
import {
  WalletError,
  type SignPsbtRequest,
  type WalletAdapter,
  type WalletConnection,
  type WalletId,
} from "./types";
import {
  browserNetwork,
  bitcoinNetwork,
  splitAddresses,
  type BrowserNetwork,
  type SdkAddress,
} from "./resolve";
export { inputsOwnedBy } from "./resolve";

/**
 * Adapters over @ordzaar/ordit-sdk.
 *
 * The SDK is used directly rather than through ord-connect, its React wrapper:
 * ord-connect pins React 18 against this app's 19 and ships its own stylesheet,
 * while the SDK it wraps has no peer dependencies at all. What ord-connect adds
 * is a wallet picker, and Cove has its own design to answer to.
 */

function fail(walletName: string, e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/cancel|reject|denied|user/i.test(message)) {
    throw new WalletError("REJECTED", `${walletName} request was cancelled`);
  }
  if (/not installed|no provider|is not defined/i.test(message)) {
    throw new WalletError("NOT_INSTALLED", `${walletName} is not installed`);
  }
  throw new WalletError("FAILED", `${walletName}: ${message}`);
}

/** The PSBT, signed but not finalized, back as base64. */
function serialized(result: { base64: string | null; hex: string }): string {
  if (result.base64) return result.base64;
  // A wallet that only returned hex still returned a PSBT, because finalize
  // and extractTx were both off.
  return Psbt.fromHex(result.hex).toBase64();
}

const SIGHASH_ALL = bitcoin.Transaction.SIGHASH_ALL;

/**
 * Every wallet is asked for the same thing: sign these indexes, with
 * SIGHASH_ALL, and do not finalize. They differ only in how they want to be
 * told, which is all these adapters resolve.
 */
function makeAdapter(spec: {
  id: WalletId;
  name: string;
  installUrl: string;
  isInstalled: () => boolean | Promise<boolean>;
  getAddresses: (network: BrowserNetwork) => Promise<SdkAddress[]>;
  sign: (psbt: Psbt, network: BrowserNetwork, request: SignPsbtRequest) => Promise<string>;
  signMessage: (network: BrowserNetwork, address: string, message: string) => Promise<string>;
}): WalletAdapter {
  return {
    id: spec.id,
    name: spec.name,
    installUrl: spec.installUrl,
    async isInstalled() {
      try {
        return await spec.isInstalled();
      } catch {
        return false;
      }
    },
    async connect(network) {
      const net = browserNetwork(network);
      let addresses: SdkAddress[];
      try {
        addresses = await spec.getAddresses(net);
      } catch (e) {
        fail(spec.name, e);
      }
      const { payments, ordinals } = splitAddresses(addresses, network);
      return { walletId: spec.id, payments, ordinals } satisfies WalletConnection;
    },
    async signPsbt(network, request) {
      const net = browserNetwork(network);
      const psbt = Psbt.fromBase64(request.psbtBase64, { network: bitcoinNetwork(network) });
      try {
        return await spec.sign(psbt, net, request);
      } catch (e) {
        fail(spec.name, e);
      }
    },
    async signMessage(network, address, message) {
      const net = browserNetwork(network);
      try {
        return await spec.signMessage(net, address, message);
      } catch (e) {
        fail(spec.name, e);
      }
    },
  };
}

/** The shape four of the seven wallets want: per-address signing indexes. */
function inputsToSign(request: SignPsbtRequest) {
  return request.inputsByAddress.map((group) => ({
    address: group.address,
    signingIndexes: group.indexes,
    sigHash: SIGHASH_ALL,
  }));
}

function allIndexes(request: SignPsbtRequest): number[] {
  return request.inputsByAddress.flatMap((g) => g.indexes).sort((a, b) => a - b);
}

export const ADAPTERS: WalletAdapter[] = [
  makeAdapter({
    id: "xverse",
    name: "Xverse",
    installUrl: "https://www.xverse.app/download",
    isInstalled: () => xverse.isInstalled(),
    getAddresses: (network) => xverse.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network, request) =>
      serialized(
        await xverse.signPsbt(psbt, {
          network,
          inputsToSign: inputsToSign(request),
          finalize: false,
          extractTx: false,
        }),
      ),
    signMessage: async (network, address, message) => {
      // Once, not twice: each call is a prompt the user has to approve.
      const r = await xverse.signMessage(message, address, network);
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "unisat",
    name: "Unisat",
    installUrl: "https://unisat.io/download",
    isInstalled: () => unisat.isInstalled(),
    getAddresses: (network) => unisat.getAddresses(network) as Promise<SdkAddress[]>,
    // Unisat decides for itself which inputs it can sign; it has the keys for
    // exactly the addresses it gave us and no others.
    sign: async (psbt) =>
      serialized(await unisat.signPsbt(psbt, { finalize: false, extractTx: false })),
    signMessage: async (_network, _address, message) => {
      const r = await unisat.signMessage(message, "bip322-simple");
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "magiceden",
    name: "Magic Eden",
    installUrl: "https://wallet.magiceden.io/",
    isInstalled: () => magiceden.isInstalled(),
    getAddresses: (network) => magiceden.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network, request) =>
      serialized(
        await magiceden.signPsbt(psbt, {
          network,
          inputsToSign: inputsToSign(request),
          finalize: false,
          extractTx: false,
        }),
      ),
    signMessage: async (network, address, message) => {
      const r = await magiceden.signMessage(message, address, network);
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "okx",
    name: "OKX",
    installUrl: "https://www.okx.com/web3",
    isInstalled: () => okx.isInstalled(),
    getAddresses: (network) => okx.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network, request) =>
      serialized(
        await okx.signPsbt(psbt, {
          network,
          inputsToSign: inputsToSign(request),
          finalize: false,
          extractTx: false,
        }),
      ),
    signMessage: async (network, _address, message) => {
      const r = await okx.signMessage(message, "bip322-simple", network);
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "leather",
    name: "Leather",
    installUrl: "https://leather.io/install-extension",
    isInstalled: () => leather.isInstalled(),
    getAddresses: (network) => leather.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network, request) =>
      serialized(
        await leather.signPsbt(psbt, {
          network,
          signAtIndexes: allIndexes(request),
          allowedSighash: [SIGHASH_ALL],
          finalize: false,
          extractTx: false,
        }),
      ),
    signMessage: async (network, _address, message) => {
      const r = await leather.signMessage(message, {
        network,
        paymentType: LeatherAddressType.P2WPKH,
      });
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "phantom",
    name: "Phantom",
    installUrl: "https://phantom.app/download",
    isInstalled: () => phantom.isInstalled(),
    getAddresses: (network) => phantom.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network, request) =>
      serialized(
        await phantom.signPsbt(psbt, {
          network,
          inputsToSign: inputsToSign(request),
          finalize: false,
          extractTx: false,
        }),
      ),
    signMessage: async (network, address, message) => {
      const r = await phantom.signMessage(message, address, network);
      return r.base64 ?? r.hex;
    },
  }),
  makeAdapter({
    id: "oyl",
    name: "Oyl",
    installUrl: "https://www.oyl.io/",
    isInstalled: () => oyl.isInstalled(),
    getAddresses: (network) => oyl.getAddresses(network) as Promise<SdkAddress[]>,
    sign: async (psbt, network) =>
      serialized(await oyl.signPsbt(psbt, { network, finalize: false, extractTx: false })),
    signMessage: async (network, address, message) => {
      const r = await oyl.signMessage(message, address, network);
      return r.base64 ?? r.hex;
    },
  }),
];

export function adapterFor(id: WalletId): WalletAdapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new WalletError("UNSUPPORTED", `unknown wallet ${id}`);
  return adapter;
}

