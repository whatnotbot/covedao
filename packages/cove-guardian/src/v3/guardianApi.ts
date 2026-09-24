import type * as bitcoin from "bitcoinjs-lib";
import type { CoveCanonicalView } from "@crclaunch/cove-covenant";
import type { VaultRecoveryProfile } from "@crclaunch/cove-vault";
import type { SignedTransitionResult, GuardianV3Network } from "./types.js";

/**
 * Guardian SERVICE protocol + transport abstraction (Phase 8.1 §19-§20, §24).
 * The remote client talks to the Guardian service through a narrow, typed,
 * authenticated protocol — ONLY `health` and `sign` (MINT/REDEEM). There is no
 * generic sign endpoint. The transport is pluggable: an HTTP transport for
 * production and an in-process transport for tests/fixtures.
 *
 * The application NEVER supplies the backing state, input values, fees, or
 * supply — it sends only the PSBT + operation + tokenId, and the service
 * reconstructs the canonical view from its own DB/Core.
 */

export interface GuardianSignRequestWire {
  requestId: string;
  operation: "MINT" | "REDEEM";
  network: GuardianV3Network;
  psbtBase64: string;
  tokenId: string; // 64-hex; the service cross-checks against the PSBT
}

export interface GuardianSignSuccess {
  ok: true;
  /** 64-byte BIP340 Schnorr signature (hex), for independent client verify. */
  sigHex: string;
  /** The PSBT with input 0 finalized (the client applies this witness). */
  signedPsbtBase64: string;
  profileHash: string;
  guardianXOnly: string;
  /** SignedTransitionResult, bigint-safe JSON (see stringifyBigint). */
  resultJson: string;
}

export interface GuardianSignFailure {
  ok: false;
  reason: string;
  detail: string;
}

export type GuardianSignResponseWire = GuardianSignSuccess | GuardianSignFailure;

export interface GuardianHealthWire {
  reachable: boolean;
  releaseId: string;
  profileHash: string;
  guardianXOnly: string;
  auditHeadHash: string;
  auditHealthy: boolean;
  signingJournalHealthy: boolean;
  custodyBackendReady: boolean;
  signingEnabled: boolean;
}

export interface GuardianTransport {
  health(): Promise<GuardianHealthWire>;
  sign(req: GuardianSignRequestWire): Promise<GuardianSignResponseWire>;
}

/** The minimal request surface the Guardian service signs (structural). */
export interface GuardianSignServiceRequest {
  psbt: bitcoin.Psbt;
  view: CoveCanonicalView;
  network: GuardianV3Network;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  feeScript: Buffer;
  maxMinerFeeSats?: bigint;
}
export type GuardianSignServiceOutcome = SignedTransitionResult | { ok: false; reason: string; detail: string };
export interface GuardianSigningService {
  signMint(req: GuardianSignServiceRequest): Promise<GuardianSignServiceOutcome>;
  signRedeem(req: GuardianSignServiceRequest): Promise<GuardianSignServiceOutcome>;
}

/** Bigint-safe JSON round-trip (bigint ↔ { __bigint: "…" } marker). */
export function stringifyBigint(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? { __bigint: val.toString() } : val));
}
export function parseBigint<T>(s: string): T {
  return JSON.parse(s, (_k, val) =>
    val && typeof val === "object" && typeof val.__bigint === "string" ? BigInt(val.__bigint) : val,
  ) as T;
}

/** Extract the 64-byte signature (first witness stack item) from a serialized witness. */
export function extractWitnessSig(witness: Buffer): Buffer {
  let off = 0;
  const readVarInt = (): number => {
    const b = witness[off]!;
    off += 1;
    if (b < 0xfd) return b;
    if (b === 0xfd) { const v = witness.readUInt16LE(off); off += 2; return v; }
    if (b === 0xfe) { const v = witness.readUInt32LE(off); off += 4; return v; }
    const v = Number(witness.readBigUInt64LE(off)); off += 8; return v;
  };
  const count = readVarInt();
  if (count < 1) throw new Error("empty witness");
  const len = readVarInt();
  return Buffer.from(witness.subarray(off, off + len));
}

export interface InProcessGuardianTransportOptions {
  signer: GuardianSigningService;
  profileHash: string;
  guardianXOnly: string;
  decode: (psbtBase64: string) => { psbt: bitcoin.Psbt };
  loadView: (tokenId: string) => Promise<CoveCanonicalView>;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  feeScript: Buffer;
  maxMinerFeeSats?: bigint;
}

/** In-process transport (tests/fixtures): calls the signing service directly. */
export class InProcessGuardianTransport implements GuardianTransport {
  constructor(private readonly opts: InProcessGuardianTransportOptions) {}
  async health(): Promise<GuardianHealthWire> {
    return {
      reachable: true,
      releaseId: "in-process-fixture",
      profileHash: this.opts.profileHash,
      guardianXOnly: this.opts.guardianXOnly,
      auditHeadHash: "0".repeat(64),
      auditHealthy: true,
      signingJournalHealthy: true,
      custodyBackendReady: true,
      signingEnabled: true,
    };
  }
  async sign(req: GuardianSignRequestWire): Promise<GuardianSignResponseWire> {
    const { psbt } = this.opts.decode(req.psbtBase64);
    const view = await this.opts.loadView(req.tokenId);
    const base = {
      network: req.network,
      recoveryKeyXOnly: this.opts.recoveryKeyXOnly,
      recoveryProfile: this.opts.recoveryProfile,
      feeScript: this.opts.feeScript,
      maxMinerFeeSats: this.opts.maxMinerFeeSats,
    };
    const outcome = req.operation === "MINT"
      ? await this.opts.signer.signMint({ psbt, view, ...base })
      : await this.opts.signer.signRedeem({ psbt, view, ...base });
    if (!outcome.ok) return { ok: false, reason: outcome.reason, detail: outcome.detail };
    const w = psbt.data.inputs[0]!.finalScriptWitness!;
    const sig = extractWitnessSig(w);
    return {
      ok: true,
      sigHex: sig.toString("hex"),
      signedPsbtBase64: psbt.toBase64(),
      profileHash: this.opts.profileHash,
      guardianXOnly: this.opts.guardianXOnly,
      resultJson: stringifyBigint(outcome),
    };
  }
}
