import { describe, expect, it } from "vitest";
import { CoveChainView } from "./resolver.js";
import { s0StateV2 } from "./transitionV2.js";

const ATOMS = 100_000_000n;
const TOKEN_A = Buffer.alloc(32, 0xaa);
const TOKEN_B = Buffer.alloc(32, 0xbb);
const P2TR = Buffer.from("5120" + "cc".repeat(32), "hex");

function viewWithToken(tokenId = TOKEN_A): CoveChainView {
  const v = new CoveChainView();
  v.deploy(
    {
      tokenId,
      ticker: "FROG",
      policyVersion: 3,
      deployTxid: "dd".repeat(32),
      tokenNonce: Buffer.alloc(32, 1),
    },
    { txid: "dd".repeat(32), vout: 1 },
    s0StateV2({ tokenId: tokenId.toString("hex") }),
  );
  return v;
}

describe("CoveChainView (§4 / §18)", () => {
  it("resolves token inputs ONLY from actual tx inputs (not caller claims)", () => {
    const v = viewWithToken();
    v.mint({
      tokenId: TOKEN_A,
      nextState: s0StateV2({ tokenId: TOKEN_A.toString("hex") }),
      prevBackingOutpoint: { txid: "dd".repeat(32), vout: 1 },
      nextBackingOutpoint: { txid: "ee".repeat(32), vout: 1 },
      recipientOutpoint: { txid: "ee".repeat(32), vout: 0 },
      recipientScript: P2TR,
      amountAtoms: 10n * ATOMS,
    });
    // Transaction that does NOT spend the token outpoint resolves to nothing.
    const none = v.resolveTokenInputs([{ txid: "ff".repeat(32), vout: 0 }]);
    expect(none).toEqual([]);
    // Transaction that DOES spend it resolves the token.
    const yes = v.resolveTokenInputs([{ txid: "ee".repeat(32), vout: 0 }]);
    expect(yes.length).toBe(1);
    expect(yes[0]!.amountAtoms).toBe(10n * ATOMS);
  });

  it("spending a token UTXO removes it (no double-spend)", () => {
    const v = viewWithToken();
    v.mint({
      tokenId: TOKEN_A,
      nextState: s0StateV2({ tokenId: TOKEN_A.toString("hex") }),
      prevBackingOutpoint: { txid: "dd".repeat(32), vout: 1 },
      nextBackingOutpoint: { txid: "ee".repeat(32), vout: 1 },
      recipientOutpoint: { txid: "ee".repeat(32), vout: 0 },
      recipientScript: P2TR,
      amountAtoms: 10n * ATOMS,
    });
    v.transfer({
      tokenId: TOKEN_A,
      spentOutpoints: [{ txid: "ee".repeat(32), vout: 0 }],
      created: [
        { outpoint: { txid: "aa".repeat(32), vout: 0 }, script: P2TR, amountAtoms: 10n * ATOMS },
      ],
    });
    // The old outpoint is gone; spending it again fails.
    expect(() =>
      v.transfer({
        tokenId: TOKEN_A,
        spentOutpoints: [{ txid: "ee".repeat(32), vout: 0 }],
        created: [
          { outpoint: { txid: "bb".repeat(32), vout: 0 }, script: P2TR, amountAtoms: 10n * ATOMS },
        ],
      }),
    ).toThrow(/not in canonical set/);
  });

  it("mixed token input rejected", () => {
    const v = viewWithToken(TOKEN_A);
    v.deploy(
      {
        tokenId: TOKEN_B,
        ticker: "DOG",
        policyVersion: 3,
        deployTxid: "cc".repeat(32),
        tokenNonce: Buffer.alloc(32, 2),
      },
      { txid: "cc".repeat(32), vout: 1 },
      s0StateV2({ tokenId: TOKEN_B.toString("hex") }),
    );
    v.mint({
      tokenId: TOKEN_B,
      nextState: s0StateV2({ tokenId: TOKEN_B.toString("hex") }),
      prevBackingOutpoint: { txid: "cc".repeat(32), vout: 1 },
      nextBackingOutpoint: { txid: "dd".repeat(32), vout: 1 },
      recipientOutpoint: { txid: "dd".repeat(32), vout: 0 },
      recipientScript: P2TR,
      amountAtoms: 5n * ATOMS,
    });
    // Attempt to transfer TOKEN_A but spend TOKEN_B's outpoint → rejected.
    expect(() =>
      v.transfer({
        tokenId: TOKEN_A,
        spentOutpoints: [{ txid: "dd".repeat(32), vout: 0 }],
        created: [
          { outpoint: { txid: "aa".repeat(32), vout: 0 }, script: P2TR, amountAtoms: 5n * ATOMS },
        ],
      }),
    ).toThrow(/mixed token input/);
  });

  it("duplicate tokenId deploy rejected", () => {
    const v = viewWithToken();
    expect(() =>
      v.deploy(
        {
          tokenId: TOKEN_A,
          ticker: "FROG",
          policyVersion: 3,
          deployTxid: "zz".repeat(32),
          tokenNonce: Buffer.alloc(32, 9),
        },
        { txid: "zz".repeat(32), vout: 1 },
        s0StateV2({ tokenId: TOKEN_A.toString("hex") }),
      ),
    ).toThrow(/duplicate/);
  });

  it("stale backing outpoint rejected on mint/redeem", () => {
    const v = viewWithToken();
    expect(() =>
      v.mint({
        tokenId: TOKEN_A,
        nextState: s0StateV2({ tokenId: TOKEN_A.toString("hex") }),
        prevBackingOutpoint: { txid: "99".repeat(32), vout: 0 },
        nextBackingOutpoint: { txid: "ee".repeat(32), vout: 1 },
        recipientOutpoint: { txid: "ee".repeat(32), vout: 0 },
        recipientScript: P2TR,
        amountAtoms: 1n,
      }),
    ).toThrow(/stale backing outpoint/);
  });
});
