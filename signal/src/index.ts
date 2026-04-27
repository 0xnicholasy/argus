// AXL Node A entrypoint — Signal node.
// Flow: receive vault snapshot → 0G inference → persist envelope to 0G Storage
// → AXL `propose` to Node B with {storageRoot, outputHash, chatId}.

import { randomBytes } from "node:crypto";
import { hexlify } from "ethers";
import type { Hex, SwarmMessage } from "@argus/shared";
import { loadSignalConfig, type SignalConfig } from "./config.js";
import { runInference, type VaultStatePrompt } from "./infer.js";
import { persistEnvelope } from "./storage.js";
import { createAxlClient } from "./axl.js";

export interface SignalRunResult {
  requestId: Hex;
  chatId: string;
  isVerified: boolean;
  storageRoot: string;
  outputHash: Hex;
}

export async function runOnce(state: VaultStatePrompt, peer: string, cfg?: SignalConfig): Promise<SignalRunResult> {
  const config = cfg ?? loadSignalConfig();
  const axl = createAxlClient({ apiAddr: config.axl.apiAddr });

  const inferred = await runInference(config, state);
  if (!inferred.isVerified) {
    throw new Error(`processResponse() returned false for chatId=${inferred.chatId}`);
  }

  const upload = await persistEnvelope(config, {
    rawBytes: inferred.rawBytes,
    outputHash: inferred.outputHash,
    signalPayload: inferred.signalPayload,
    chatId: inferred.chatId,
    inputSnapshot: inferred.inputSnapshot,
  });

  // 32-byte cryptographic random for replay-resistant request IDs (codex HIGH).
  // bytes32 directly fits the Vault EIP-712 SwapTag.requestId field — no UUID parsing.
  const requestId = hexlify(randomBytes(32)) as Hex;
  const message: SwarmMessage = {
    requestId,
    kind: "propose",
    chatId: inferred.chatId,
    storageRoot: upload.storageRoot,
    outputHash: inferred.outputHash,
    timestamp: Math.floor(Date.now() / 1000),
  };
  await axl.send(peer, message);

  console.log(
    JSON.stringify({
      level: "info",
      event: "signal.proposed",
      chatId: inferred.chatId,
      isVerified: inferred.isVerified,
      storageRoot: upload.storageRoot,
      outputHash: inferred.outputHash,
      requestId,
      action: inferred.signalPayload.action,
    }),
  );

  return {
    requestId,
    chatId: inferred.chatId,
    isVerified: inferred.isVerified,
    storageRoot: upload.storageRoot,
    outputHash: inferred.outputHash,
  };
}

async function main(): Promise<void> {
  const cfg = loadSignalConfig();
  const peer = process.env.SIGNAL_PEER;
  if (!peer) throw new Error("SIGNAL_PEER (Node B Yggdrasil pubkey or IPv6) required");
  const vaultAddrEnv = process.env.VAULT_ADDRESS;
  if (!vaultAddrEnv) throw new Error("VAULT_ADDRESS required");

  const state: VaultStatePrompt = {
    vaultAddress: vaultAddrEnv as Hex,
    tokenBalances: [],
    unichainBlock: 0,
  };
  await runOnce(state, peer, cfg);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: "error", event: "signal.failed", error: msg }));
    process.exit(1);
  });
}
