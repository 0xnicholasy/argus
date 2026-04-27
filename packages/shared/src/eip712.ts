// EIP-712 domain + SwapTag schema. Must match ArgusVault.sol _SWAP_TAG_TYPEHASH exactly.
// Solidity: keccak256("SwapTag(bytes32 chatIdHash,bytes32 outputHash,uint256 nonce,bytes32 requestId,address tokenIn,address tokenOut,uint256 amountIn)")

import type { Hex, VaultSwapTag } from "./types.js";

export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301 as const;

export const EIP712_DOMAIN_NAME = "ArgusVault" as const;
export const EIP712_DOMAIN_VERSION = "1" as const;

export interface Eip712Domain {
  name: typeof EIP712_DOMAIN_NAME;
  version: typeof EIP712_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Hex;
}

export const SWAP_TAG_TYPES = {
  SwapTag: [
    { name: "chatIdHash", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "requestId", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
  ],
} as const;

export const SWAP_TAG_PRIMARY_TYPE = "SwapTag" as const;

export function buildDomain(verifyingContract: Hex, chainId: number = UNICHAIN_SEPOLIA_CHAIN_ID): Eip712Domain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export interface TypedDataPayload {
  domain: Eip712Domain;
  types: typeof SWAP_TAG_TYPES;
  primaryType: typeof SWAP_TAG_PRIMARY_TYPE;
  message: VaultSwapTag;
}

export function buildSwapTagTypedData(
  domain: Eip712Domain,
  message: VaultSwapTag,
): TypedDataPayload {
  return {
    domain,
    types: SWAP_TAG_TYPES,
    primaryType: SWAP_TAG_PRIMARY_TYPE,
    message,
  };
}
