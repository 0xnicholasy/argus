// Runtime validation for cross-node messages. Both signal and execution use
// these schemas; never trust /recv payloads or storage envelopes by structural
// type assertion alone (codex HIGH on P4 review).

import { z } from "zod";
import type { Hex, SwarmMessage, StorageEnvelope } from "./types.js";

// Branded `0x${string}` outputs preserve the template literal type from runtime parsing.
const asHex = (re: RegExp) =>
  z.string().regex(re).transform((v): Hex => v as Hex);

const hex = asHex(/^0x[0-9a-fA-F]+$/);
const hex32 = asHex(/^0x[0-9a-fA-F]{64}$/);
const addr = asHex(/^0x[0-9a-fA-F]{40}$/);
const reqId = asHex(/^0x[0-9a-fA-F]{64}$/);

export const swarmMessageSchema = z.object({
  requestId: reqId,
  kind: z.enum(["propose", "reply", "execute", "receipt"]),
  chatId: z.string().min(1).optional(),
  storageRoot: z.string().min(1).optional(),
  outputHash: hex32.optional(),
  decision: z.enum(["accept", "reject"]).optional(),
  swapTxHash: hex.optional(),
  timestamp: z.number().int().nonnegative(),
});

export const inputSnapshotSchema = z.object({
  vaultState: z.string().min(1),
  timestampWindow: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});

export const signalPayloadSchema = z.object({
  action: z.enum(["rebalance", "hold"]),
  tokenIn: addr,
  tokenOut: addr,
  amountIn: z.string().regex(/^[0-9]+$/),
  reason: z.string().max(200),
  chatId: z.string().min(1),
  inputSnapshot: inputSnapshotSchema,
});

export const storageEnvelopeSchema = z.object({
  rawBytesB64: z.string().min(1),
  outputHash: hex32,
  signalPayload: signalPayloadSchema,
  chatId: z.string().min(1),
  inputSnapshot: inputSnapshotSchema,
});

export function parseSwarmMessage(value: unknown): SwarmMessage {
  // schema produces structurally identical SwarmMessage; explicit cast bridges
  // zod's transformed `0x${string}` infer back onto our nominal Hex template type.
  return swarmMessageSchema.parse(value) satisfies SwarmMessage;
}

export function parseStorageEnvelope(value: unknown): StorageEnvelope {
  return storageEnvelopeSchema.parse(value) satisfies StorageEnvelope;
}
