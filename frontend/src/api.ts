import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { SHIM_URL, UNICHAIN_RPC, VAULT_ADDRESS, WETH_ADDRESS, USDC_ADDRESS } from "./config";
import type { ShimEntry, VaultBalances } from "./types";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

let _provider: JsonRpcProvider | null = null;
function provider(): JsonRpcProvider {
  if (!_provider) _provider = new JsonRpcProvider(UNICHAIN_RPC);
  return _provider;
}

export async function trigger(): Promise<ShimEntry> {
  const r = await fetch(`${SHIM_URL}/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`trigger failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as ShimEntry;
}

export async function getStatus(requestId: string): Promise<ShimEntry> {
  const r = await fetch(`${SHIM_URL}/status/${requestId}`);
  if (!r.ok) throw new Error(`status failed: ${r.status}`);
  return (await r.json()) as ShimEntry;
}

export async function getHealth(): Promise<{ status: string; pending: number }> {
  const r = await fetch(`${SHIM_URL}/health`);
  if (!r.ok) throw new Error(`health failed: ${r.status}`);
  return (await r.json()) as { status: string; pending: number };
}

export async function readVault(): Promise<VaultBalances> {
  const p = provider();
  const weth = new Contract(WETH_ADDRESS, ERC20_ABI, p);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, p);
  const [w, u, bn] = await Promise.all([
    weth.balanceOf(VAULT_ADDRESS) as Promise<bigint>,
    usdc.balanceOf(VAULT_ADDRESS) as Promise<bigint>,
    p.getBlockNumber(),
  ]);
  return { weth: w, usdc: u, blockNumber: bn };
}

export function fmtWeth(v: bigint): string {
  return Number(formatUnits(v, 18)).toFixed(6);
}

export function fmtUsdc(v: bigint): string {
  return Number(formatUnits(v, 6)).toFixed(2);
}
