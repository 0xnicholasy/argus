// EIP-712 signer for VaultSwapTag. Domain + types come from @argus/shared (frozen P3).
// Solidity counterpart: ArgusVault._SWAP_TAG_TYPEHASH + _hashTypedDataV4.

import { Wallet, toUtf8Bytes, keccak256, type TypedDataField } from "ethers";
import {
  buildDomain,
  SWAP_TAG_TYPES,
} from "@argus/shared";
import type { Hex, VaultSwapTag } from "@argus/shared";

// ethers v6's TypedDataField wants a mutable record. Our shared SWAP_TAG_TYPES is
// declared `as const` so consumers can't accidentally mutate the schema; cast once
// here to bridge the readonly-vs-mutable variance.
const SWAP_TAG_TYPES_ETHERS: Record<string, TypedDataField[]> = SWAP_TAG_TYPES as unknown as Record<string, TypedDataField[]>;

export interface SignedSwapTag {
  tag: VaultSwapTag;
  signature: Hex;
  chatIdHash: Hex;
}

export interface SignSwapTagInput {
  wallet: Wallet;
  vaultAddress: Hex;
  chainId: number;
  chatId: string;
  outputHash: Hex;
  nonce: bigint;
  requestId: Hex;
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: bigint;
}

/// keccak256(utf8(chatId)) — Solidity counterpart hashes the chatId string off-chain
/// and stores only chatIdHash. Signal/Execution must use identical encoding.
export function hashChatId(chatId: string): Hex {
  return keccak256(toUtf8Bytes(chatId)) as Hex;
}

export async function signSwapTag(input: SignSwapTagInput): Promise<SignedSwapTag> {
  const chatIdHash = hashChatId(input.chatId);
  const tag: VaultSwapTag = {
    chatIdHash,
    outputHash: input.outputHash,
    nonce: input.nonce,
    requestId: input.requestId,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
  };

  const domain = buildDomain(input.vaultAddress, input.chainId);
  // ethers v6 strips the EIP712Domain entry from the types map automatically when
  // it's absent — pass only the SwapTag definition (matches viem.signTypedData).
  const signature = (await input.wallet.signTypedData(
    domain,
    SWAP_TAG_TYPES_ETHERS,
    tag,
  )) as Hex;

  return { tag, signature, chatIdHash };
}
