import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** BigInt monetary/supply/height columns (no float). */
const atoms = (name: string) => bigint(name, { mode: "bigint" });

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deploymentTxid: text("deployment_txid").notNull(),
    ticker: text("ticker").notNull(),
    tickerNormalized: text("ticker_normalized").notNull(),
    name: text("name").notNull(),
    creatorAddress: text("creator_address").notNull(),
    network: text("network").notNull(),
    status: text("status").notNull().default("DRAFT"),
    totalSupplyAtoms: atoms("total_supply_atoms").notNull(),
    publicSupplyAtoms: atoms("public_supply_atoms").notNull(),
    reserveSupplyAtoms: atoms("reserve_supply_atoms").notNull(),
    confirmedMintedAtoms: atoms("confirmed_minted_atoms").notNull().$defaultFn(() => 0n),
    pendingMintedAtoms: atoms("pending_minted_atoms").notNull().$defaultFn(() => 0n),
    reserveSats: atoms("reserve_sats").notNull().$defaultFn(() => 0n),
    lastTradePricePerMillion: atoms("last_trade_price_per_million"),
    currentStage: integer("current_stage").notNull().default(1),
    deployHeight: atoms("deploy_height"),
    deployBlockHash: text("deploy_block_hash"),
    protocolStateHash: text("protocol_state_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tokens_deployment_network_uq").on(t.network, t.deploymentTxid),
    index("tokens_ticker_idx").on(t.network, t.tickerNormalized),
    index("tokens_status_created_idx").on(t.status, t.createdAt),
    index("tokens_status_minted_idx").on(t.status, t.confirmedMintedAtoms),
  ],
);

export const tokenMetadata = pgTable(
  "token_metadata",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Immutable deployment txid — survives projection rebuilds (tokens get new UUIDs). */
    deploymentTxid: text("deployment_txid").notNull(),
    description: text("description").notNull().default(""),
    websiteUrl: text("website_url"),
    xUrl: text("x_url"),
    imageHash: text("image_hash"),
    imageUrl: text("image_url"),
    thumbUrl: text("thumb_url"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    termsWalletAddress: text("terms_wallet_address"),
    isVerified: boolean("is_verified").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("token_metadata_deployment_uq").on(t.deploymentTxid)],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "cascade" }),
    txid: text("txid"),
    creatorAddress: text("creator_address").notNull(),
    network: text("network").notNull(),
    status: text("status").notNull().default("CREATED"),
    launchFeeSats: atoms("launch_fee_sats").notNull(),
    minerFeeSats: atoms("miner_fee_sats").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("deployments_txid_uq").on(t.network, t.txid)],
);

export const chainTransactions = pgTable(
  "chain_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    txid: text("txid"),
    operation: text("operation").notNull(),
    walletAddress: text("wallet_address").notNull(),
    status: text("status").notNull().default("CREATED"),
    idempotencyKey: text("idempotency_key"),
    deploymentId: text("deployment_id"),
    errorCode: text("error_code"),
    payloadJson: jsonb("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chain_tx_network_txid_uq").on(t.network, t.txid),
    uniqueIndex("chain_tx_idempotency_uq").on(t.walletAddress, t.operation, t.idempotencyKey),
    index("chain_tx_wallet_idx").on(t.walletAddress, t.createdAt),
  ],
);

export const chainEvents = pgTable(
  "chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    blockHeight: atoms("block_height").notNull(),
    blockHash: text("block_hash").notNull(),
    txid: text("txid").notNull(),
    eventIndex: integer("event_index").notNull(),
    eventType: text("event_type").notNull(),
    deploymentId: text("deployment_id"),
    walletFrom: text("wallet_from"),
    walletTo: text("wallet_to"),
    tokenAmountAtoms: atoms("token_amount_atoms"),
    btcAmountSats: atoms("btc_amount_sats"),
    payloadJson: jsonb("payload_json"),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chain_events_network_txid_idx_uq").on(t.network, t.txid, t.eventIndex),
    index("chain_events_block_idx").on(t.network, t.blockHeight),
    index("chain_events_deployment_idx").on(t.deploymentId, t.blockHeight),
    index("chain_events_wallet_idx").on(t.walletFrom, t.blockHeight),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    height: atoms("height").notNull(),
    hash: text("hash").notNull(),
    parentHash: text("parent_hash").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blocks_network_height_uq").on(t.network, t.height)],
);

export const indexerCursors = pgTable("indexer_cursors", {
  id: text("id").primaryKey(),
  network: text("network").notNull(),
  lastHeight: atoms("last_height").notNull().$defaultFn(() => 0n),
  lastBlockHash: text("last_block_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reorgEvents = pgTable("reorg_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  network: text("network").notNull(),
  fromHeight: atoms("from_height").notNull(),
  toHeight: atoms("to_height").notNull(),
  orphanedBlockHash: text("orphaned_block_hash"),
  details: jsonb("details"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletTokenBalances = pgTable(
  "wallet_token_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    walletAddress: text("wallet_address").notNull(),
    deploymentId: text("deployment_id").notNull(),
    balanceAtoms: atoms("balance_atoms").notNull().$defaultFn(() => 0n),
    pendingAtoms: atoms("pending_atoms").notNull().$defaultFn(() => 0n),
    lockedAtoms: atoms("locked_atoms").notNull().$defaultFn(() => 0n),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("balances_wallet_deployment_uq").on(t.network, t.walletAddress, t.deploymentId),
    index("balances_wallet_idx").on(t.walletAddress),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: text("listing_id").notNull(),
    network: text("network").notNull(),
    deploymentId: text("deployment_id").notNull(),
    sellerAddress: text("seller_address").notNull(),
    tokenAmountAtoms: atoms("token_amount_atoms").notNull(),
    askingPriceSats: atoms("asking_price_sats").notNull(),
    creationHeight: atoms("creation_height").notNull(),
    expiryHeight: atoms("expiry_height").notNull(),
    status: text("status").notNull().default("BUILDING"),
    txid: text("txid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_listing_id_uq").on(t.listingId),
    index("listings_deployment_status_idx").on(t.deploymentId, t.status),
    index("listings_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    deploymentId: text("deployment_id").notNull(),
    listingId: text("listing_id").notNull(),
    buyerAddress: text("buyer_address").notNull(),
    sellerAddress: text("seller_address").notNull(),
    tokenAmountAtoms: atoms("token_amount_atoms").notNull(),
    priceSats: atoms("price_sats").notNull(),
    pricePerMillionSats: atoms("price_per_million_sats").notNull(),
    protocolFeeSats: atoms("protocol_fee_sats").notNull().$defaultFn(() => 0n),
    platformFeeSats: atoms("platform_fee_sats").notNull().$defaultFn(() => 0n),
    txid: text("txid").notNull(),
    blockHeight: atoms("block_height").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_txid_uq").on(t.network, t.txid),
    index("trades_deployment_idx").on(t.deploymentId, t.createdAt),
    index("trades_block_idx").on(t.blockHeight),
  ],
);

export const mints = pgTable(
  "mints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    deploymentId: text("deployment_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    tokenAmountAtoms: atoms("token_amount_atoms").notNull(),
    curveContributionSats: atoms("curve_contribution_sats").notNull(),
    platformFeeSats: atoms("platform_fee_sats").notNull(),
    minerFeeSats: atoms("miner_fee_sats").notNull(),
    txid: text("txid"),
    status: text("status").notNull().default("CREATED"),
    blockHeight: atoms("block_height"),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mints_txid_uq").on(t.network, t.txid),
    index("mints_deployment_idx").on(t.deploymentId, t.createdAt),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    deploymentId: text("deployment_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    mode: text("mode").notNull(),
    tokensAtoms: atoms("tokens_atoms").notNull(),
    curveContributionSats: atoms("curve_contribution_sats").notNull(),
    platformFeeSats: atoms("platform_fee_sats").notNull(),
    estimatedMinerFeeSats: atoms("estimated_miner_fee_sats").notNull(),
    totalEstimatedSpendSats: atoms("total_estimated_spend_sats").notNull(),
    startingStage: integer("starting_stage").notNull(),
    endingStage: integer("ending_stage").notNull(),
    supplyBeforeAtoms: atoms("supply_before_atoms").notNull(),
    supplyAfterAtoms: atoms("supply_after_atoms").notNull(),
    stateHash: text("state_hash").notNull(),
    expiresAtHeight: atoms("expires_at_height").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_deployment_idx").on(t.deploymentId, t.createdAt)],
);

export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    termsVersion: text("terms_version").notNull(),
    network: text("network").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("terms_wallet_version_uq").on(t.walletAddress, t.termsVersion)],
);

export const featureFlags = pgTable("feature_flags", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    variant: text("variant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("media_hash_variant_uq").on(t.contentHash, t.variant)],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterAddress: text("reporter_address"),
  targetType: text("target_type").notNull(),
  deploymentId: text("deployment_id"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: text("admin_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeLedger = pgTable(
  "fee_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    txid: text("txid").notNull(),
    eventIndex: integer("event_index").notNull(),
    operation: text("operation").notNull(),
    expectedSats: atoms("expected_sats").notNull(),
    observedSats: atoms("observed_sats").notNull(),
    confirmationStatus: text("confirmation_status").notNull().default("PENDING"),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fee_ledger_txid_idx_uq").on(t.network, t.txid, t.eventIndex)],
);

export const protocolSnapshots = pgTable("protocol_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  network: text("network").notNull(),
  stateHash: text("state_hash").notNull(),
  height: atoms("height").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Cove V1 (Bitcoin signet) persistent indexer state ───────────────────────

export const coveBlocks = pgTable(
  "cove_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    height: atoms("height").notNull(),
    hash: text("hash").notNull(),
    parentHash: text("parent_hash").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cove_blocks_height_uq").on(t.network, t.height),
    index("cove_blocks_hash_idx").on(t.network, t.hash),
  ],
);

export const coveOperations = pgTable(
  "cove_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    txid: text("txid").notNull(),
    blockHeight: atoms("block_height").notNull(),
    txIndex: integer("tx_index").notNull(),
    operation: text("operation"),
    classification: text("classification").notNull(),
    valid: boolean("valid").notNull(),
    reason: text("reason"),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cove_ops_txid_uq").on(t.network, t.txid),
    index("cove_ops_block_height_idx").on(t.network, t.blockHeight),
  ],
);

export const coveTokens = pgTable(
  "cove_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    deploymentId: text("deployment_id").notNull(),
    ticker: text("ticker").notNull(),
    creator: text("creator").notNull(),
    confirmedSupplyAtoms: atoms("confirmed_supply_atoms").notNull(),
    currentStage: integer("current_stage").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cove_tokens_deployment_uq").on(t.network, t.deploymentId)],
);

export const coveBalances = pgTable(
  "cove_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    ownerScript: text("owner_script").notNull(),
    deploymentId: text("deployment_id").notNull(),
    availableAtoms: atoms("available_atoms").notNull(),
    lockedAtoms: atoms("locked_atoms").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cove_balances_owner_uq").on(t.network, t.ownerScript, t.deploymentId)],
);

export const coveCheckpoints = pgTable(
  "cove_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    height: atoms("height").notNull(),
    blockHash: text("block_hash").notNull(),
    stateRoot: text("state_root").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cove_checkpoints_height_uq").on(t.network, t.height)],
);

export const coveCursor = pgTable(
  "cove_cursor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    network: text("network").notNull(),
    height: atoms("height").notNull(),
    blockHash: text("block_hash").notNull(),
    /** True while a reorg rebuild is in progress (clearCove → reindex). */
    rebuilding: boolean("rebuilding").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cove_cursor_network_uq").on(t.network)],
);
