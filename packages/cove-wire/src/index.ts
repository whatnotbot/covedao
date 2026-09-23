export {
  COVE_PROTOCOL_ID,
  COVE_WIRE_VERSION,
  COVE_WIRE_MAGIC,
  OP_DEPLOY,
  OP_TRANSFER,
  OP_MINT,
  OP_REDEEM,
  MAX_TICKER_BYTES,
  DATACARRIER_PAYLOAD_LIMIT,
  opName,
} from "./opcodes.js";
export {
  encodeDeploy,
  encodeAmount,
  decode,
  WireError,
  type DeployEnvelope,
  type AmountEnvelope,
  type ParsedEnvelope,
} from "./codec.js";
