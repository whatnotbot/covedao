import { describe, expect, it } from "vitest";
import { decodeRawTransaction, LocalP2WPKHSigner, psbtIntent } from "@crclaunch/bitcoin";
import { buildCoveDeployPsbt, COVE_V1_SIGNET_CONFIG } from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";

const CFG = COVE_V1_SIGNET_CONFIG;
// Deterministic test actor key (privkey = 32×0x42).
const ACTOR_WIF = "cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW";
const ACTOR_SCRIPT = "001414db4138d56a2ecfb10881a9be394d9f321985b2";

describe("Cove end-to-end build → sign → decode → validate (local signer)", () => {
  it("builds a DEPLOY, signs it locally, and the indexer validates the signed tx", async () => {
    const signer = new LocalP2WPKHSigner(ACTOR_WIF, "signet");
    expect(signer.getAddress()).toBe("tb1qznd5zwx4dghvlvggsx5muw2dnuepnpdj7ud0ys");

    const psbt = buildCoveDeployPsbt({
      network: "signet",
      ticker: "FROG",
      inputs: [{ txid: "b".repeat(64), vout: 0, scriptPubKeyHex: ACTOR_SCRIPT, valueSats: 1_000_000n, confirmations: 6 }],
      changeAddress: signer.getAddress(),
      feeRateSatVb: 2n,
      config: CFG,
    });

    const signedHex = await signer.signPsbt(
      psbt.psbtBase64,
      psbtIntent(psbt.unsignedHex, {
        maxFeeSats: CFG.maxMinerFeeSats,
        changeScriptPubKeyHex: psbt.changeSats > 0n ? ACTOR_SCRIPT : undefined,
      }),
    );
    expect(signedHex).toMatch(/^020000000001/); // version 2 + segwit marker

    // The signed raw tx is authoritative. Decode it and resolve the prevout.
    const decoded = decodeRawTransaction(signedHex, "signet");
    decoded.inputs[0]!.prevScriptPubKeyHex = ACTOR_SCRIPT;

    const idx = new CoveIndexer(CFG);
    const r = idx.processTx(CFG.genesisHeight, 0, decoded);
    expect(r.classification).toBe("VALID");
    expect(r.operation).toBe("DEPLOY");
    expect(idx.getStats().tokens).toBe(1);
    expect(idx.getState().tickerIndex.get("FROG")).toBe(decoded.txid);
  });
});
