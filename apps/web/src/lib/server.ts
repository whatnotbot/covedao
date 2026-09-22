import "dotenv/config";
import { Redis } from "ioredis";
import type { Database } from "@crclaunch/db";
import { createDb } from "@crclaunch/db";
import {
  MockChainNode,
  MockCRCAdapter,
  PrecopCRCAdapter,
  RedisMockStorage,
  MockCanonicalCRCProvider,
  UnavailableCanonicalCRCProvider,
  type CRCProtocolAdapter,
  type CanonicalCRCProvider,
} from "@crclaunch/protocol";
import { MockBitcoinProvider, type BitcoinProvider } from "@crclaunch/bitcoin";
import { getConfig } from "./env";

interface Services {
  config: ReturnType<typeof getConfig>;
  db: Database;
  redis: Redis;
  node: MockChainNode | null;
  adapter: CRCProtocolAdapter;
  bitcoin: BitcoinProvider;
  canonical: CanonicalCRCProvider;
}

const globalForServer = globalThis as unknown as { __crcServices?: Services };

export function getServices(): Services {
  if (globalForServer.__crcServices) return globalForServer.__crcServices;
  const config = getConfig();
  const db = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  let node: MockChainNode | null = null;
  let adapter: CRCProtocolAdapter;
  let bitcoin: BitcoinProvider;
  let canonical: CanonicalCRCProvider;

  if (config.network === "mock") {
    node = new MockChainNode(new RedisMockStorage(redis), config.network);
    const mockAdapter = new MockCRCAdapter(node);
    adapter = mockAdapter;
    bitcoin = new MockBitcoinProvider(node);
    canonical = new MockCanonicalCRCProvider(mockAdapter, node);
  } else {
    adapter = new PrecopCRCAdapter(config.protocolUrl);
    canonical = new UnavailableCanonicalCRCProvider();
    // Read-only provider stub until a real Bitcoin RPC provider is configured.
    const readOnlyBitcoin: BitcoinProvider = {
      getHeight: async () => 0n,
      getBlockHash: async () => "",
      getTransaction: async (txid: string) => ({
        txid,
        hex: "",
        blockHeight: null,
        confirmations: 0,
        status: "UNKNOWN" as const,
      }),
      getUtxos: async () => [],
      getFeeEstimates: async () => ({
        fastestSatVb: 1n,
        halfHourSatVb: 1n,
        hourSatVb: 1n,
        minimumSatVb: 1n,
      }),
      broadcast: async () => {
        throw new Error("broadcast not available in read-only mode");
      },
    };
    bitcoin = readOnlyBitcoin;
  }

  const services: Services = { config, db, redis, node, adapter, bitcoin, canonical };
  globalForServer.__crcServices = services;
  return services;
}

export async function initServices(): Promise<Services> {
  const s = getServices();
  if (s.node) await s.node.init();
  return s;
}
