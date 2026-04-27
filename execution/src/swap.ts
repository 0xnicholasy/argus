// Submits the agent-signed swap to ArgusVault.executeRebalance on Unichain Sepolia.
// Note: msg.sender must equal agentEOA — the execution-node wallet IS the agent EOA
// in this topology (codex HIGH on P2 review). Same key signs the EIP-712 tag and
// pays gas. Vault contract enforces both.

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  parseUnits,
  type BaseContract,
  type ContractTransactionResponse,
  type InterfaceAbi,
} from "ethers";
import { ArgusVaultAbi } from "@argus/shared";
import type { Hex, SignalPayload, VaultSwapTag } from "@argus/shared";
import type { ExecutionConfig } from "./config.js";

const BPS = 10_000n;

interface VaultContract extends BaseContract {
  executeRebalance(
    p: SwapParamsTuple,
    chatIdHash: Hex,
    outputHash: Hex,
    nonce: bigint,
    requestId: Hex,
    agentSig: Hex,
  ): Promise<ContractTransactionResponse>;
  usedNonces(nonce: bigint): Promise<boolean>;
}

interface SwapParamsTuple {
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
}

export interface SubmitSwapInput {
  cfg: ExecutionConfig;
  wallet: Wallet;
  signalPayload: SignalPayload;
  swapTag: VaultSwapTag;
  signature: Hex;
  chatIdHash: Hex;
  // amountOutMin must be supplied by the caller — the execution node is responsible
  // for fetching a fresh quote (P5 dryrun pattern) and applying slippage. The signal
  // node never picks slippage so a leaked sig can't be replayed at a worse price.
  amountOutMin: bigint;
}

export interface SubmitSwapResult {
  txHash: Hex;
  blockNumber: number;
  status: "success" | "reverted";
}

export function applySlippage(amountOut: bigint, slippageBps: bigint): bigint {
  if (slippageBps >= BPS) throw new Error(`slippageBps ${slippageBps} must be < ${BPS}`);
  return (amountOut * (BPS - slippageBps)) / BPS;
}

export function buildVaultProvider(cfg: ExecutionConfig): JsonRpcProvider {
  return new JsonRpcProvider(cfg.unichain.rpcUrl, cfg.unichain.chainId);
}

export function getVaultContract(cfg: ExecutionConfig, wallet: Wallet): VaultContract {
  // ArgusVaultAbi is the JSON ABI array exported from @argus/shared/abi/ArgusVault.json.
  return new Contract(cfg.vaultAddress, ArgusVaultAbi as unknown as InterfaceAbi, wallet) as unknown as VaultContract;
}

export async function submitSwap(input: SubmitSwapInput): Promise<SubmitSwapResult> {
  const { cfg, wallet, signalPayload, swapTag, signature, amountOutMin } = input;

  const vault = getVaultContract(cfg, wallet);
  if (await vault.usedNonces(swapTag.nonce)) {
    throw new Error(`nonce already used on-chain: ${swapTag.nonce}`);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + cfg.swap.deadlineSeconds);
  const swapParams: SwapParamsTuple = {
    tokenIn: swapTag.tokenIn,
    tokenOut: swapTag.tokenOut,
    fee: cfg.swap.feeTier,
    amountIn: swapTag.amountIn,
    amountOutMin,
    deadline,
  };

  // Sanity: signalPayload addresses must match the signed tag (defense-in-depth — the
  // SwapTag is the only on-chain truth, but a mismatch indicates upstream tampering).
  if (
    signalPayload.tokenIn.toLowerCase() !== swapTag.tokenIn.toLowerCase() ||
    signalPayload.tokenOut.toLowerCase() !== swapTag.tokenOut.toLowerCase() ||
    BigInt(signalPayload.amountIn) !== swapTag.amountIn
  ) {
    throw new Error("signalPayload mismatch with signed swapTag");
  }

  const tx = await vault.executeRebalance(
    swapParams,
    swapTag.chatIdHash,
    swapTag.outputHash,
    swapTag.nonce,
    swapTag.requestId,
    signature,
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`executeRebalance returned no receipt for tx ${tx.hash}`);
  return {
    txHash: tx.hash as Hex,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "success" : "reverted",
  };
}

/// Helper for ad-hoc CLI runs — converts a human amount string ("0.001") for a
/// known-decimal token into the wei-scaled bigint expected by the vault.
export function toBaseUnits(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}
