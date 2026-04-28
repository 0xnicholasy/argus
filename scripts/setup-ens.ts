// Set Namestone subname for the agent (P11 — ENS Identity).
// Run: tsx scripts/setup-ens.ts
//
// Prereqs (gated):
//   - Sepolia .eth owned by signer (NAMESTONE_PARENT_DOMAIN), Namestone form approved
//   - NAMESTONE_API_KEY emailed by Namestone (24h human gate)
//   - VAULT_ADDRESS deployed (P2) — written into agent.vault text record
//   - REPO_URL set — written into url text record
//
// Acceptance: viem.getEnsAddress({ name: "<sub>.<parent>" }) on Sepolia returns agent EOA,
// and every required text record reads back with the expected value.
// Idempotent: re-running with identical config is a no-op (Namestone setName upserts).

import "dotenv/config";
import { Wallet } from "ethers";
import NameStone, { type TextRecords } from "@namestone/namestone-sdk";
import { createPublicClient, http } from "viem";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { loadEnv, requireVaultAddress } from "../packages/shared/src/env.js";

const RESOLVE_ATTEMPTS = 5;
const RESOLVE_DELAY_MS = 2000;

const ONE_LABEL = /^[a-z0-9-]{1,63}$/;
const PARENT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function require_(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing env: ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
  const env = loadEnv();

  const apiKey = require_("NAMESTONE_API_KEY", env.NAMESTONE_API_KEY);
  const parent = require_("NAMESTONE_PARENT_DOMAIN", env.NAMESTONE_PARENT_DOMAIN).toLowerCase();
  const sub = (env.NAMESTONE_SUBNAME ?? "rebalancer").toLowerCase();
  const vault = requireVaultAddress(env);
  const repoUrl = require_("REPO_URL", env.REPO_URL);

  if (!ONE_LABEL.test(sub)) {
    throw new Error(`NAMESTONE_SUBNAME must be a single label [a-z0-9-]: got "${sub}"`);
  }
  if (!PARENT_DOMAIN.test(parent)) {
    throw new Error(`NAMESTONE_PARENT_DOMAIN must be a parent ENS name: got "${parent}"`);
  }

  const fqdn = normalize(`${sub}.${parent}`);
  const agent = new Wallet(env.PRIVATE_KEY).address;
  const model = env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct";

  const text_records: TextRecords = {
    "agent.model": model,
    "agent.keeper": "keeperhub",
    "agent.chain": "unichain-sepolia",
    "agent.vault": vault,
    "agent.erc8004": env.ERC8004_STATUS ?? "pending",
    url: repoUrl,
  };

  const ns = new NameStone(apiKey, { network: "sepolia" });
  const client = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC) });

  console.log(`[setup-ens] parent=${parent} sub=${sub} agent=${agent}`);

  // Defensive: log the parent's resolver. Do not hard-fail — Sepolia Namestone resolver
  // address is not exported by the SDK; the acceptance check below proves it works.
  try {
    const resolver = await client.getEnsResolver({ name: parent });
    console.log(`      parent resolver = ${resolver}`);
  } catch (e) {
    console.warn(`      parent resolver lookup failed: ${(e as Error).message}`);
  }

  console.log(`[1/3] POST set-name ${fqdn} -> ${agent}`);
  await ns.setName({ name: sub, domain: parent, address: agent, text_records });

  console.log(`[2/3] viem.getEnsAddress(${fqdn}) on sepolia (up to ${RESOLVE_ATTEMPTS} attempts)`);
  let resolved: `0x${string}` | null = null;
  for (let i = 0; i < RESOLVE_ATTEMPTS; i++) {
    resolved = await client.getEnsAddress({ name: fqdn });
    if (resolved && resolved.toLowerCase() === agent.toLowerCase()) break;
    if (i < RESOLVE_ATTEMPTS - 1) await sleep(RESOLVE_DELAY_MS);
  }
  if (!resolved) throw new Error(`ENS resolution returned null for ${fqdn}`);
  if (resolved.toLowerCase() !== agent.toLowerCase()) {
    throw new Error(`address mismatch: got ${resolved}, expected ${agent}`);
  }
  console.log(`      resolved = ${resolved}`);

  console.log(`[3/3] read & assert text records`);
  for (const [key, expected] of Object.entries(text_records)) {
    let got: string | null = null;
    for (let i = 0; i < RESOLVE_ATTEMPTS; i++) {
      got = await client.getEnsText({ name: fqdn, key });
      if (got === expected) break;
      if (i < RESOLVE_ATTEMPTS - 1) await sleep(RESOLVE_DELAY_MS);
    }
    if (got !== expected) {
      throw new Error(`text record mismatch ${key}: got ${got ?? "<null>"}, expected ${expected}`);
    }
    console.log(`      ${key} = ${got}`);
  }
  console.log(`OK ${fqdn} -> ${agent}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`setup-ens failed: ${msg}`);
  process.exit(1);
});
