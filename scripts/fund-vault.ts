// Fund ArgusVault with WETH + USDC on Unichain Sepolia.
// Run: tsx scripts/fund-vault.ts
//
// Prereqs: PRIVATE_KEY funded with both tokens; VAULT_ADDRESS set.
// Approves vault.deposit() pull, then calls deposit(token, amount) for each.

import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits, type BaseContract } from "ethers";
import ArgusVaultAbi from "../packages/shared/src/abi/ArgusVault.json" with { type: "json" };
import { loadEnv, requireVaultAddress } from "../packages/shared/src/env.js";

const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

type Erc20 = BaseContract & {
  approve(spender: string, value: bigint): Promise<{ wait: () => Promise<unknown> }>;
  allowance(owner: string, spender: string): Promise<bigint>;
  balanceOf(addr: string): Promise<bigint>;
  decimals(): Promise<bigint>;
  symbol(): Promise<string>;
};

type Vault = BaseContract & {
  deposit(token: string, amount: bigint): Promise<{ wait: () => Promise<unknown>; hash: string }>;
};

interface FundTarget {
  envKey: string;
  amountHuman: string;
}

const TARGETS: FundTarget[] = [
  { envKey: "FUND_TOKEN_WETH", amountHuman: "0.01" },
  { envKey: "FUND_TOKEN_USDC", amountHuman: "10" },
];

async function fundOne(wallet: Wallet, vaultAddr: string, tokenAddr: string, amountHuman: string): Promise<void> {
  const erc = new Contract(tokenAddr, ERC20_ABI, wallet) as unknown as Erc20;
  const [decRaw, sym, ownerBal] = await Promise.all([erc.decimals(), erc.symbol(), erc.balanceOf(wallet.address)]);
  const dec = Number(decRaw);
  const amount = parseUnits(amountHuman, dec);
  if (ownerBal < amount) {
    throw new Error(`${sym}: signer holds ${formatUnits(ownerBal, dec)}, need ${amountHuman}`);
  }
  const allowance = await erc.allowance(wallet.address, vaultAddr);
  if (allowance < amount) {
    console.log(`approving ${sym} ${amountHuman} -> vault`);
    const tx = await erc.approve(vaultAddr, amount);
    await tx.wait();
  }
  const vault = new Contract(vaultAddr, ArgusVaultAbi, wallet) as unknown as Vault;
  console.log(`depositing ${amountHuman} ${sym}...`);
  const dep = await vault.deposit(tokenAddr, amount);
  await dep.wait();
  console.log(`  ${sym} deposit tx: ${dep.hash}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const vaultAddr = requireVaultAddress(env);
  const provider = new JsonRpcProvider(env.UNICHAIN_SEPOLIA_RPC);
  const wallet = new Wallet(env.PRIVATE_KEY, provider);

  console.log(`Signer: ${wallet.address}`);
  console.log(`Vault:  ${vaultAddr}`);

  for (const t of TARGETS) {
    const tokenAddr = process.env[t.envKey];
    if (!tokenAddr) {
      console.warn(`skip ${t.envKey}: not set in env`);
      continue;
    }
    await fundOne(wallet, vaultAddr, tokenAddr, t.amountHuman);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`fund-vault failed: ${msg}`);
  process.exit(1);
});
