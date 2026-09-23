import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { bitcoin } from "@crclaunch/bitcoin";

function classify(script: Uint8Array): string {
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return "P2WPKH";
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return "P2TR";
  if (script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 0x14) return "P2PKH";
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14) return "P2SH";
  return "UNSUPPORTED";
}

function decodeAddress(label: string, address: string): void {
  try {
    const script = bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
    const type = classify(script);
    const roundtrip = bitcoin.address.fromOutputScript(script, bitcoin.networks.bitcoin);
    const supported = type === "P2WPKH" || type === "P2TR";
    if (!supported) {
      console.error(`${label}: unsupported script type ${type} (only P2WPKH/P2TR).`);
      process.exit(1);
    }
    console.log(`${label}`);
    console.log(`  address:      ${roundtrip}`);
    console.log(`  scriptPubKey: ${Buffer.from(script).toString("hex")}`);
    console.log(`  script type:  ${type}`);
  } catch (e) {
    console.error(`${label}: invalid or wrong-network address "${address}": ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

const treasury = process.env.COVE_MAINNET_TREASURY_ADDRESS;
const settlement = process.env.COVE_MAINNET_SETTLEMENT_ADDRESS;

if (!treasury || !settlement) {
  console.error("Both COVE_MAINNET_TREASURY_ADDRESS and COVE_MAINNET_SETTLEMENT_ADDRESS are required.");
  console.error("MAINNET TREASURY ADDRESS: REQUIRED");
  console.error("MAINNET SETTLEMENT ADDRESS: REQUIRED");
  process.exit(1);
}

console.log("Cove V1 mainnet custody intake (mainnet parameters)");
decodeAddress("TREASURY", treasury);
decodeAddress("SETTLEMENT", settlement);
console.log("✓ addresses decode as mainnet P2WPKH/P2TR. No private keys were generated, printed, or stored.");
