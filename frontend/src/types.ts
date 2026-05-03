export type ShimStatus = "pending" | "done" | "rejected";

export interface ShimEntry {
  requestId: string;
  status: ShimStatus;
  createdAt: number;
  updatedAt?: number;
  swapTxHash?: string;
  chatId?: string;
  outputHash?: string;
  storageRoot?: string;
  reason?: string;
}

export interface VaultBalances {
  weth: bigint;
  usdc: bigint;
  blockNumber: number;
}
