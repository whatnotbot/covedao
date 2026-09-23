export type { BitcoinTx, Utxo, FeeEstimates, BitcoinNodeLike, BitcoinProvider } from "./types.js";
export { MockBitcoinProvider } from "./mock.js";

export {
  decodeRawTransaction,
  opReturnPayload,
  outputAddress,
  btcNetwork,
  bitcoin,
  type BitcoinProtocolTx,
  type DecodedInput,
  type DecodedOutput,
  type NetworkName,
} from "./decoder.js";
export {
  CoreRpcProvider,
  type BitcoinChainProvider,
  type BitcoinBlock,
  type ChainUtxo,
} from "./provider.js";
export { buildUnsignedPsbt, opReturnScript, type CovePsbt, type BuildTxParams } from "./psbt.js";
