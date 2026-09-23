export type { BitcoinTx, Utxo, FeeEstimates, BitcoinNodeLike, BitcoinProvider } from "./types.js";
export { MockBitcoinProvider } from "./mock.js";

export {
  decodeRawTransaction,
  opReturnPayload,
  parseCanonicalOpReturn,
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
  btcPerKvbToSatPerVb,
  testMempoolAcceptParams,
  type BitcoinChainProvider,
  type BitcoinBlock,
  type ChainUtxo,
  type BlockchainInfo,
} from "./provider.js";
export {
  buildUnsignedPsbt,
  opReturnScript,
  opReturnScriptData,
  estimateInputVsize,
  estimateOutputVsize,
  type CovePsbt,
  type BuildTxParams,
} from "./psbt.js";
export {
  dustThreshold,
  isWitnessProgram,
  isP2WPKH,
  isP2TR,
  DUST_RELAY_FEE_SAT_PER_KVB,
} from "./dust.js";
export { LocalP2WPKHSigner, type WalletSigner } from "./signer.js";
export { EsploraUtxoProvider } from "./esplora.js";
