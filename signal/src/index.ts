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

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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

function requireAddressEnv(name: string): Hex {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} required for signal prompt`);
  }
  if (!ADDRESS_RE.test(value)) {
    throw new Error(`${name} must be a 0x address`);
  }
  return value as Hex;
}

/**
 * AXL Node A recv loop. Drains incoming SwarmMessages, dispatches `execute`
 * triggers (from the KeeperHub-facing shim) into the inference + propose flow,
 * and forwards `receipt`/`reply` messages from Node B back to the shim via
 * POST {SHIM_URL}/receipt. This is the D1 webhook flow — the shim no longer
 * drains /recv itself, so there is no race between two consumers.
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

  const shimUrl = cfg.env.SHIM_URL;
  if (!shimUrl) {
    logEvent("signal.shim_url_unset", { note: "receipt/reply messages will be logged then dropped" });
  }

  const axl = createAxlClient({ apiAddr: cfg.axl.apiAddr });

  logEvent("signal.started", { axl: cfg.axl.apiAddr, peer, vault: vaultAddrEnv, shimUrl: shimUrl ?? null });

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

    if (msg.kind === "receipt" || msg.kind === "reply") {
      if (!shimUrl) {
        logError("signal.receipt_dropped_no_shim", { requestId: msg.requestId, kind: msg.kind });
        continue;
      }
      try {
        const r = await fetch(`${shimUrl.replace(/\/+$/, "")}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg),
        });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          logError("signal.shim_post_failed", {
            requestId: msg.requestId,
            kind: msg.kind,
            status: r.status,
            body: body.slice(0, 200),
          });
        } else {
          logEvent("signal.shim_forwarded", { requestId: msg.requestId, kind: msg.kind });
        }
      } catch (e) {
        logError("signal.shim_post_error", {
          requestId: msg.requestId,
          kind: msg.kind,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }

    if (msg.kind !== "execute") {
      logEvent("signal.kind_skipped", { requestId: msg.requestId, kind: msg.kind });
      continue;
    }
    if (seenRequestIds.has(msg.requestId)) {
      logError("signal.replay_requestId", { requestId: msg.requestId });
      continue;
    }
    seenRequestIds.add(msg.requestId);

    logEvent("signal.trigger_received", { requestId: msg.requestId });

    try {
      // Vault snapshot is hackathon-stub. Empty balances would let the model
      // hallucinate token addresses → schema rejects (codex HIGH on P4).
      // Seed with the demo's funded WETH/USDC pair so the model picks from
      // real addresses. Pulled from FUND_TOKEN_* (already used by fund-vault).
      const usdc = requireAddressEnv("FUND_TOKEN_USDC");
      const weth = requireAddressEnv("FUND_TOKEN_WETH");
      const state: VaultStatePrompt = {
        vaultAddress: vaultAddrEnv as Hex,
        tokenBalances: [
          { token: weth, symbol: "WETH", balance: "10000000000000000" },
          { token: usdc, symbol: "USDC", balance: "10000000" },
        ],
        unichainBlock: 0,
      };
      await runOnce(state, peer, cfg, { requestId: msg.requestId as Hex });
    } catch (e) {
      logError("signal.handler_failed", {
        requestId: msg.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Forward the failure straight to the shim. AXL-to-Node-B would just be
      // dropped (B drops non-propose kinds) — under D1, signal owns the
      // shim-facing path for receipts AND for handler-side rejects.
      const reject = {
        requestId: msg.requestId,
        kind: "reply" as const,
        decision: "reject" as const,
        timestamp: Math.floor(Date.now() / 1000),
      };
      if (!shimUrl) {
        logError("signal.reject_drop_no_shim", { requestId: msg.requestId });
      } else {
        try {
          const r = await fetch(`${shimUrl.replace(/\/+$/, "")}/receipt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(reject),
          });
          if (!r.ok) {
            const body = await r.text().catch(() => "");
            logError("signal.reject_post_failed", {
              requestId: msg.requestId,
              status: r.status,
              body: body.slice(0, 200),
            });
          }
        } catch (sendErr) {
          logError("signal.reject_post_error", {
            requestId: msg.requestId,
            error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          });
        }
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
