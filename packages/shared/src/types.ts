// Frozen interface contracts shared between signal, execution, shim.
// Any change here is a breaking schema change — bump version + audit consumers.

export type Hex = `0x${string}`;

export type SwarmMessageKind = "propose" | "reply" | "execute" | "receipt";

export interface SwarmMessage {
  requestId: string;
  kind: SwarmMessageKind;
  chatId?: string;
  storageRoot?: string;
  outputHash?: Hex;
  decision?: "accept" | "reject";
  swapTxHash?: Hex;
  timestamp: number;
}

export interface InputSnapshot {
  vaultState: string;
  timestampWindow: [number, number];
}

export interface SignalPayload {
  action: "rebalance" | "hold";
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: string;
  reason: string;
  chatId: string;
  inputSnapshot: InputSnapshot;
}

// Canonical raw model output is stored as base64 + an explicit outputHash so the
// envelope self-binds the bytes that were hashed and TEE-verified. Consumers MUST:
//   1. base64-decode rawBytesB64 -> bytes
//   2. assert keccak256(bytes) === outputHash
//   3. only then trust signalPayload (which is a parsed projection)
export interface StorageEnvelope {
  rawBytesB64: string;
  outputHash: Hex;
  signalPayload: SignalPayload;
  chatId: string;
  inputSnapshot: InputSnapshot;
}

export interface SwapParams {
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
}

export interface VaultSwapTag {
  chatIdHash: Hex;
  outputHash: Hex;
  nonce: bigint;
  requestId: Hex;
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: bigint;
}

export interface ShimRequestPending {
  status: "pending";
  requestId: string;
  createdAt: number;
}

export interface ShimRequestDone {
  status: "done";
  requestId: string;
  createdAt: number;
  swapTxHash: Hex;
  chatId: string;
  outputHash: Hex;
  storageRoot: string;
}

export interface ShimRequestRejected {
  status: "rejected";
  requestId: string;
  createdAt: number;
  reason: string;
}

export type ShimRequest = ShimRequestPending | ShimRequestDone | ShimRequestRejected;
