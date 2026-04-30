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

export interface RunOnceOptions {
  /**
   * Override the random requestId so the trigger from the shim (and KH) flows
   * through the swarm with the same ID end-to-end. When omitted, a fresh
   * 32-byte random ID is minted (legacy single-shot behaviour).
   */
  requestId?: Hex;
}

export async function runOnce(
  state: VaultStatePrompt,
  peer: string,
  cfg?: SignalConfig,
  opts?: RunOnceOptions,
): Promise<SignalRunResult> {
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
  const requestId = opts?.requestId ?? (hexlify(randomBytes(32)) as Hex);
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

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}

/**
 * AXL Node A recv loop. Drains incoming SwarmMessages, dispatches `execute`
 * triggers (from the KeeperHub-facing shim) into the inference + propose flow
 * keyed by the original requestId.
 *
 * KNOWN RACE: in the cloud topology the shim ALSO drains Node A's /recv
 * looking for receipts/replies destined for KH polls. Both processes pop
 * from the same FIFO queue, so an "execute" trigger can be popped by the
 * shim (which drops non-receipt kinds) and lost. Mitigation lives in the
 * shim — see shim/src/index.ts startReceiptLoop. For demo determinism,
 * stop the shim recv loop while running this worker, OR migrate to the
 * planned /receipt webhook flow (signal worker pushes status to shim).
 */
async function runRecvLoop(): Promise<never> {
  const cfg = loadSignalConfig();
  // EXECUTION_PEER is Node B's pubkey — the destination of `propose`.
  // Falls back to SIGNAL_PEER for backwards compatibility with the
  // pre-recv-loop one-shot invocation.
  const peer = process.env.EXECUTION_PEER ?? process.env.SIGNAL_PEER;
  if (!peer) {
    throw new Error("EXECUTION_PEER (Node B Yggdrasil pubkey) required for recv loop");
  }
  const vaultAddrEnv = process.env.VAULT_ADDRESS;
  if (!vaultAddrEnv) throw new Error("VAULT_ADDRESS required");

  const axl = createAxlClient({ apiAddr: cfg.axl.apiAddr });

  logEvent("signal.started", { axl: cfg.axl.apiAddr, peer, vault: vaultAddrEnv });

  const seenRequestIds = new Set<string>();

  for (;;) {
    let msg: Awaited<ReturnType<typeof axl.recv>>;
    try {
      msg = await axl.recv(15_000);
    } catch (e) {
      logError("signal.recv_failed", { error: e instanceof Error ? e.message : String(e) });
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    if (!msg) continue;
    if (msg.kind !== "execute") {
      // Receipts/replies belong to the shim's recv loop — drop quietly.
      continue;
    }
    if (seenRequestIds.has(msg.requestId)) {
      logError("signal.replay_requestId", { requestId: msg.requestId });
      continue;
    }
    seenRequestIds.add(msg.requestId);

    logEvent("signal.trigger_received", { requestId: msg.requestId });

    try {
      // Vault snapshot is hackathon-stub (per P14 plan) — empty balances +
      // current block are good enough until the demo wires a real reader.
      const state: VaultStatePrompt = {
        vaultAddress: vaultAddrEnv as Hex,
        tokenBalances: [],
        unichainBlock: 0,
      };
      await runOnce(state, peer, cfg, { requestId: msg.requestId as Hex });
    } catch (e) {
      logError("signal.handler_failed", {
        requestId: msg.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Forward the failure as a `reply` so the shim closes the request
      // instead of waiting for a receipt that will never arrive.
      try {
        await axl.send(peer, {
          requestId: msg.requestId,
          kind: "reply",
          decision: "reject",
          timestamp: Math.floor(Date.now() / 1000),
        });
      } catch (sendErr) {
        logError("signal.reject_send_failed", {
          requestId: msg.requestId,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRecvLoop().catch((err: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError("signal.fatal", { error: errMsg });
    process.exit(1);
  });
}
