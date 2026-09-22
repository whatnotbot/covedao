import { ok } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import {
  listBalancesForWallet,
  listListingsBySeller,
  listMintsByWallet,
  listTradesByWallet,
} from "@crclaunch/db";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { db, config, node } = getServices();
  await initServices();
  const { address } = await ctx.params;

  const [balances, mints, trades, listings] = await Promise.all([
    listBalancesForWallet(db, config.network, address),
    listMintsByWallet(db, config.network, address),
    listTradesByWallet(db, config.network, address),
    listListingsBySeller(db, config.network, address),
  ]);

  const btcSats = node ? (await node.getWalletBalance(address)).btcSats : 0n;

  return ok({
    address,
    btcSats: btcSats.toString(),
    balances: balances.map((b) => ({
      deploymentId: b.deploymentId,
      balanceAtoms: b.balanceAtoms.toString(),
      pendingAtoms: b.pendingAtoms.toString(),
      lockedAtoms: b.lockedAtoms.toString(),
    })),
    mints: mints.map((m) => ({
      txid: m.txid,
      deploymentId: m.deploymentId,
      tokenAmountAtoms: m.tokenAmountAtoms.toString(),
      curveContributionSats: m.curveContributionSats.toString(),
      platformFeeSats: m.platformFeeSats.toString(),
      status: m.status,
    })),
    trades: trades.map((t) => ({
      txid: t.txid,
      deploymentId: t.deploymentId,
      tokenAmountAtoms: t.tokenAmountAtoms.toString(),
      priceSats: t.priceSats.toString(),
      side: t.buyerAddress === address ? "BUY" : "SELL",
    })),
    listings: listings.map((l) => ({
      listingId: l.listingId,
      deploymentId: l.deploymentId,
      tokenAmountAtoms: l.tokenAmountAtoms.toString(),
      askingPriceSats: l.askingPriceSats.toString(),
      status: l.status,
    })),
  });
}
