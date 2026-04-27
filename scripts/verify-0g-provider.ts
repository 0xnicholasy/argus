// Verify ZEROG_PROVIDER_ADDRESS is reachable, serves deepseek-chat-v3-0324 with
// TeeML, and that getServiceMetadata returns a usable endpoint.
//
// Run: tsx scripts/verify-0g-provider.ts

import "dotenv/config";
import { createRequire } from "node:module";
import type * as Broker from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet } from "ethers";
import { loadEnv } from "../packages/shared/src/env.js";

// 0g-serving-broker 0.7.5 ships a broken ESM bundle (rollup chunking emits
// non-existent named exports). Load the CommonJS entry which is intact.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker") as typeof Broker;

// Testnet (chain 16602) only ships qwen models. deepseek-chat-v3-0324 is mainnet-only.
// Override via ZEROG_EXPECTED_MODEL if you need a different match.
const PREFERRED_MODEL = process.env.ZEROG_EXPECTED_MODEL ?? "qwen/qwen-2.5-7b-instruct";
const PREFERRED_VERIF = "TeeML";

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.ZEROG_PROVIDER_ADDRESS) {
    throw new Error("ZEROG_PROVIDER_ADDRESS not set in .env");
  }
  const target = env.ZEROG_PROVIDER_ADDRESS.toLowerCase();

  const provider = new JsonRpcProvider(env.ZEROG_RPC);
  const wallet = new Wallet(env.PRIVATE_KEY, provider);
  console.log(`signer:   ${wallet.address}`);
  console.log(`provider: ${env.ZEROG_PROVIDER_ADDRESS}`);
  console.log(`expected: model=${PREFERRED_MODEL} verif=${PREFERRED_VERIF}\n`);

  const broker = await createZGComputeNetworkBroker(wallet);

  console.log("listService()...");
  const services = await broker.inference.listService();
  const match = services.find((s) => s.provider.toLowerCase() === target);

  if (!match) {
    console.log(`\n${services.length} services on-chain. Provider not found.`);
    console.log("First 10 candidates:");
    for (const s of services.slice(0, 10)) {
      console.log(`  ${s.provider}  model=${s.model}  verif=${s.verifiability}  url=${s.url}`);
    }
    throw new Error(`provider ${env.ZEROG_PROVIDER_ADDRESS} not registered on-chain`);
  }

  console.log(`\nProvider entry:`);
  console.log(`  model:         ${match.model}`);
  console.log(`  verifiability: ${match.verifiability}`);
  console.log(`  url:           ${match.url}`);
  console.log(`  inputPrice:    ${match.inputPrice.toString()}`);
  console.log(`  outputPrice:   ${match.outputPrice.toString()}`);

  const warnings: string[] = [];
  if (match.model !== PREFERRED_MODEL) warnings.push(`model is "${match.model}", expected "${PREFERRED_MODEL}"`);
  if (match.verifiability !== PREFERRED_VERIF) {
    warnings.push(`verifiability is "${match.verifiability}", expected "${PREFERRED_VERIF}" (TeeTLS does NOT count for the verifiable-AI claim)`);
  }

  console.log("\ngetServiceMetadata()...");
  const meta = await broker.inference.getServiceMetadata(env.ZEROG_PROVIDER_ADDRESS);
  console.log(`  endpoint: ${meta.endpoint}`);
  console.log(`  model:    ${meta.model}`);

  if (warnings.length > 0) {
    console.log("\nWARNINGS:");
    for (const w of warnings) console.log(`  - ${w}`);
    process.exit(2);
  }

  console.log(`\nOK: provider matches ${PREFERRED_MODEL} / ${PREFERRED_VERIF}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nverify-0g-provider failed: ${msg}`);
  process.exit(1);
});
