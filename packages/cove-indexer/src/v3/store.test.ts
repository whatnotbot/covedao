import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { createDb, schema } from "@crclaunch/db";
import { eq, and } from "drizzle-orm";
import { CHAIN_BITCOIN_REGTEST, encodeDeployV2, computeTokenId } from "@crclaunch/cove-wire";
import { s0StateV2 } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import { V3IndexerState } from "./state.js";
import { V3Store } from "./store.js";
import { RESERVE_ANCHOR_SATS } from "./constants.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

const URL = process.env.COVE_TEST_DATABASE_URL;
const guardianXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
const NONCE = Buffer.alloc(32, 0xab);
const feeScript = Buffer.from("0014" + "f".repeat(40), "hex");

function config() {
  return { network: "regtest" as const, chainIdentity: CHAIN_BITCOIN_REGTEST, guardianXOnly, recoveryKeyXOnly: recoveryXOnly, feeScript, genesisHeight: 0n };
}

function deployTxHex(): string {
  const tokenId = computeTokenId({ chainIdentity: CHAIN_BITCOIN_REGTEST, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
  const s0 = s0StateV2({ tokenId: tokenId.toString("hex") });
  const vault = buildBackingVaultV3({ state: s0, guardianXOnly, recoveryKeyXOnly: recoveryXOnly, network: bitcoin.networks.regtest });
  const wire = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
  const t = new bitcoin.Transaction();
  t.version = 2;
  t.addInput(Buffer.from("d0".repeat(32), "hex").reverse(), 0);
  t.addOutput(Buffer.concat([Buffer.from([0x6a, wire.length]), wire]), 0);
  t.addOutput(vault.scriptPubKey, Number(RESERVE_ANCHOR_SATS));
  return t.toHex();
}

describe.skipIf(!URL)("V3Store persistence (Postgres, atomic block + undo)", () => {
  it("persists a DEPLOY block atomically and rolls it back", async () => {
    const db = createDb(URL!);
    const store = new V3Store("regtest");
    const state = new V3IndexerState(config());
    const raw = deployTxHex();
    const block = { height: 1n, hash: "b1".padEnd(64, "0"), parentHash: "0".repeat(64), txs: [raw] };
    state.applyBlock(block);
    const undo = state.undoByHeight.get(1n)!;

    await db.transaction(async (tx) => {
      await store.persistBlock(tx, state, block, state.events, undo);
    });

    const tokens = await db.select().from(schema.coveV3Tokens);
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.ticker).toBe("FROG");
    const cursor = await db.select().from(schema.coveV3Cursor).where(eq(schema.coveV3Cursor.network, "regtest"));
    expect(cursor.length).toBe(1);
    expect(cursor[0]!.height).toBe(1n);

    // roll back atomically (cursor moves back to genesis)
    state.undoBlock(1n);
    await db.transaction(async (tx) => {
      await store.rollback(tx, undo, state.cursor);
    });
    const tokensAfter = await db.select().from(schema.coveV3Tokens);
    expect(tokensAfter.length).toBe(0);
    const undoAfter = await db.select().from(schema.coveV3Undo).where(and(eq(schema.coveV3Undo.network, "regtest"), eq(schema.coveV3Undo.height, 1n)));
    expect(undoAfter.length).toBe(0);
  });
});
