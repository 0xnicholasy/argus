// HTTP request/response shapes for the KeeperHub-facing shim.
// Vault snapshot fields are kept as strings (uint256 decimal) to avoid bigint
// JSON serialization surprises across the KeeperHub workflow node hop.

import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be bytes32 hex");
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x address");
const uintDec = z.string().regex(/^[0-9]+$/, "must be decimal uint256");

export const triggerBodySchema = z
  .object({
    requestId: hex32.optional(),
    vaultState: z
      .object({
        tokenIn: addr.optional(),
        tokenOut: addr.optional(),
        amountIn: uintDec.optional(),
        note: z.string().max(500).optional(),
      })
      .optional(),
  })
  .strict();

export type TriggerBody = z.infer<typeof triggerBodySchema>;

export interface ShimConfig {
  port: number;
  axlApiAddr: string;
  signalPeer: string;
  pollIntervalMs: number;
  pollBudgetMs: number;
  requestTtlMs: number;
}
