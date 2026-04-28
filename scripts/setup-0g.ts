// Idempotent 0G Compute boot: ensure ledger funded, provider signer acknowledged,
// and inference sub-account topped up. Safe to re-run; each step skips if already done.
//
// Run: tsx scripts/setup-0g.ts
//
// Tunables:
//   ZEROG_LEDGER_AMOUNT=3       # 0G to deposit into ledger if missing/low (contract min: 3)
//   ZEROG_LEDGER_MIN=0.5        # rebuild threshold for ledger top-up (units: OG)
//   ZEROG_PROVIDER_AMOUNT=1     # 0G to transfer to provider sub-account (units: OG -> neuron)
//   ZEROG_PROVIDER_MIN=0.1      # rebuild threshold for provider sub-account (units: OG)

import "dotenv/config";
import { createRequire } from "node:module";
import type * as Broker from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { loadEnv } from "../packages/shared/src/env.js";

// 0g-serving-broker 0.7.5 ships a broken ESM bundle (rollup chunking emits
// non-existent named exports). Load the CommonJS entry which is intact.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker") as typeof Broker;

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key}=${raw} must be positive number`);
  }
  return parsed;
};

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.ZEROG_PROVIDER_ADDRESS) {
    throw new Error("ZEROG_PROVIDER_ADDRESS not set in .env");
  }
  const provider = env.ZEROG_PROVIDER_ADDRESS;

  const ledgerAmount = num("ZEROG_LEDGER_AMOUNT", 3);
  const ledgerMin = num("ZEROG_LEDGER_MIN", 0.5);
  const providerAmount = num("ZEROG_PROVIDER_AMOUNT", 1);
  const providerMin = num("ZEROG_PROVIDER_MIN", 0.1);

  const rpc = new JsonRpcProvider(env.ZEROG_RPC);
  const wallet = new Wallet(env.PRIVATE_KEY, rpc);
  console.log(`signer:   ${wallet.address}`);
  console.log(`provider: ${provider}\n`);

  const broker = await createZGComputeNetworkBroker(wallet);

  // Step 1: ledger
  console.log("[1/3] ledger...");
  let ledgerBalanceOg = 0;
  let ledgerExists = false;
  try {
    const ledger = await broker.ledger.getLedger();
    ledgerExists = true;
    ledgerBalanceOg = Number(formatEther(ledger.totalBalance));
    console.log(`  existing ledger: ${ledgerBalanceOg} OG`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/LedgerNotExists|not exist|not found/i.test(msg)) {
      console.log("  no ledger found");
    } else {
      throw err;
    }
  }

  if (!ledgerExists) {
    console.log(`  addLedger(${ledgerAmount})...`);
    await broker.ledger.addLedger(ledgerAmount);
    console.log("  ledger created");
  } else if (ledgerBalanceOg < ledgerMin) {
    console.log(`  balance ${ledgerBalanceOg} < ${ledgerMin}, depositFund(${ledgerAmount})...`);
    await broker.ledger.depositFund(ledgerAmount);
    console.log("  topped up");
  } else {
    console.log("  ledger sufficient, skip");
  }

  // Step 2: acknowledge provider signer (TEE)
  console.log("\n[2/3] acknowledgeProviderSigner...");
  try {
    await broker.inference.acknowledgeProviderSigner(provider);
    console.log("  acknowledged");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already|acknowledged|exists/i.test(msg)) {
      console.log("  already acknowledged, skip");
    } else {
      throw err;
    }
  }

  // Step 3: provider sub-account fund
  console.log("\n[3/3] transferFund...");
  const subs = await broker.ledger.getProvidersWithBalance("inference");
  const target = provider.toLowerCase();
  const match = subs.find(([addr]) => addr.toLowerCase() === target);
  const subBalanceOg = match ? Number(formatEther(match[1])) : 0;
  console.log(`  current sub-account: ${subBalanceOg} OG`);

  if (subBalanceOg < providerMin) {
    // transferFund expects neuron (1 OG = 1e18 neuron) per d.ts.
    const neuron = parseEther(providerAmount.toString());
    console.log(`  transferFund(${providerAmount} OG = ${neuron} neuron)...`);
    await broker.ledger.transferFund(provider, "inference", neuron);
    console.log("  transferred");
  } else {
    console.log("  sub-account sufficient, skip");
  }

  console.log("\nOK: 0G compute setup complete");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nsetup-0g failed: ${msg}`);
  process.exit(1);
});
