// AXL Node B entrypoint — Execution node.
// Flow: recv `propose` SwarmMessage from Node A → fetch envelope from 0G Storage →
//       integrity hash check → processResponse() re-verify against exact bytes →
//       fresh QuoterV2 quote → EIP-712 sign VaultSwapTag → Vault.executeRebalance →
//       reply `receipt` SwarmMessage with swapTxHash.

import { randomBytes } from "node:crypto";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  hexlify,
  type BaseContract,
} from "ethers";
import type { Hex, SwarmMessage } from "@argus/shared";
import { loadExecutionConfig, type ExecutionConfig } from "./config.js";
import { createAxlClient, type AxlClient } from "./axl.js";
import { verifyEnvelope, VerificationError } from "./verify.js";
import { signSwapTag } from "./sign.js";
import { applySlippage, buildVaultProvider, submitSwap } from "./swap.js";

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

interface QuoterV2 extends BaseContract {
  quoteExactInputSingle: {
    staticCall(p: {
      tokenIn: Hex;
      tokenOut: Hex;
      amountIn: bigint;
      fee: number;
      sqrtPriceLimitX96: bigint;
    }): Promise<[bigint, bigint, number, bigint]>;
  };
}

export interface ExecutionRunResult {
  requestId: Hex;
  chatId: string;
  swapTxHash: Hex;
  blockNumber: number;
  outputHash: Hex;
  storageRoot: string;
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}

async function quoteAmountOut(cfg: ExecutionConfig, tokenIn: Hex, tokenOut: Hex, amountIn: bigint): Promise<bigint> {
  const quoterAddr = process.env.UNISWAP_QUOTER_V2;
  if (!quoterAddr) {
    if (process.env.QUOTER_OPTIONAL === "1") {
      console.error(JSON.stringify({
        level: "warn",
        event: "execution.quoter_skipped",
        reason: "UNISWAP_QUOTER_V2 not set; using amountOutMin=1 (demo mode)",
      }));
      return 1n;
    }
    throw new Error("UNISWAP_QUOTER_V2 required to fetch fresh amountOut for slippage protection");
  }
  const provider = buildVaultProvider(cfg);
  const quoter = new Contract(quoterAddr, QUOTER_V2_ABI, provider) as unknown as QuoterV2;
  const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    fee: cfg.swap.feeTier,
    sqrtPriceLimitX96: 0n,
  });
  return amountOut;
}

export interface HandlePeerOptions {
  cfg: ExecutionConfig;
  wallet: Wallet;
  axl: AxlClient;
  peer: string;
  msg: SwarmMessage;
}

export async function handleProposal(opts: HandlePeerOptions): Promise<ExecutionRunResult> {
  const { cfg, wallet, axl, peer, msg } = opts;
  if (msg.kind !== "propose") {
    throw new Error(`unexpected SwarmMessage.kind=${msg.kind} (expected 'propose')`);
  }
  if (!msg.storageRoot || !msg.outputHash || !msg.chatId) {
    throw new Error("propose message missing storageRoot/outputHash/chatId");
  }

  const verified = await verifyEnvelope(cfg, {
    storageRoot: msg.storageRoot,
    outputHash: msg.outputHash,
    chatId: msg.chatId,
  });
  // Use the rawString-derived signalPayload (codex CRITICAL — envelope.signalPayload
  // is a projection that could be tampered without breaking outputHash).
  const signalPayload = verified.signalPayload;

  if (signalPayload.action !== "rebalance") {
    // hold → reject upstream so node A can drop / log.
    const reply: SwarmMessage = {
      requestId: msg.requestId,
      kind: "reply",
      decision: "reject",
      chatId: signalPayload.chatId,
      timestamp: Math.floor(Date.now() / 1000),
    };
    await axl.send(peer, reply);
    throw new Error(`signal action=${signalPayload.action}; nothing to execute`);
  }

  const tokenIn = signalPayload.tokenIn;
  const tokenOut = signalPayload.tokenOut;
  const amountIn = BigInt(signalPayload.amountIn);

  const grossAmountOut = await quoteAmountOut(cfg, tokenIn, tokenOut, amountIn);
  const amountOutMin = applySlippage(grossAmountOut, cfg.swap.slippageBps);

  // Fresh 32-byte nonce derived locally — vault enforces uniqueness on-chain.
  // Avoid clock-based nonces (codex HIGH on signal P4 logic, applied here too).
  const nonce = BigInt(hexlify(randomBytes(32)));

  const signed = await signSwapTag({
    wallet,
    vaultAddress: cfg.vaultAddress,
    chainId: cfg.unichain.chainId,
    chatId: signalPayload.chatId,
    outputHash: msg.outputHash,
    nonce,
    requestId: msg.requestId as Hex,
    tokenIn,
    tokenOut,
    amountIn,
  });

  const result = await submitSwap({
    cfg,
    wallet,
    signalPayload,
    swapTag: signed.tag,
    signature: signed.signature,
    chatIdHash: signed.chatIdHash,
    amountOutMin,
  });

  if (result.status !== "success") {
    throw new Error(`Vault.executeRebalance reverted in tx ${result.txHash}`);
  }

  const reply: SwarmMessage = {
    requestId: msg.requestId,
    kind: "receipt",
    decision: "accept",
    chatId: signalPayload.chatId,
    storageRoot: msg.storageRoot,
    outputHash: msg.outputHash,
    swapTxHash: result.txHash,
    timestamp: Math.floor(Date.now() / 1000),
  };
  await axl.send(peer, reply);

  logEvent("execution.executed", {
    chatId: signalPayload.chatId,
    storageRoot: msg.storageRoot,
    outputHash: msg.outputHash,
    swapTxHash: result.txHash,
    blockNumber: result.blockNumber,
    requestId: msg.requestId,
    nonce: nonce.toString(),
    amountIn: amountIn.toString(),
    amountOutMin: amountOutMin.toString(),
    grossAmountOut: grossAmountOut.toString(),
  });

  return {
    requestId: msg.requestId as Hex,
    chatId: signalPayload.chatId,
    swapTxHash: result.txHash,
    blockNumber: result.blockNumber,
    outputHash: msg.outputHash,
    storageRoot: msg.storageRoot,
  };
}

async function main(): Promise<void> {
  const cfg = loadExecutionConfig();
  const axl = createAxlClient({ apiAddr: cfg.axl.apiAddr });
  const provider = new JsonRpcProvider(cfg.unichain.rpcUrl, cfg.unichain.chainId);
  const wallet = new Wallet(cfg.env.PRIVATE_KEY, provider);

  const peer = process.env.EXECUTION_PEER;
  if (!peer) throw new Error("EXECUTION_PEER (Node A Yggdrasil pubkey or IPv6) required");

  logEvent("execution.started", { agentEOA: wallet.address, vault: cfg.vaultAddress });

  // Process-level dedupe (codex HIGH): same outputHash or requestId from a replayed
  // propose must NOT trigger a second swap, even though we mint a fresh nonce.
  // Vault dedupes nonces on-chain — but only AFTER tx submission. Catching it here
  // saves gas + avoids racing chain state. Persist across restarts is out of scope
  // for the hackathon demo (acceptable per plan re-plan triggers).
  const seenRequestIds = new Set<string>();

  for (;;) {
    let envelope: Awaited<ReturnType<typeof axl.recv>>;
    try {
      envelope = await axl.recv(15_000);
    } catch (e) {
      logError("execution.recv_failed", { error: e instanceof Error ? e.message : String(e) });
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    if (!envelope) continue;

    // AXL daemon's X-From-Peer-Id is derived via Yggdrasil Address.GetKey(),
    // which only recovers ~14 bytes of pubkey prefix; the tail is 0xFF padding.
    // Compare by prefix (first 28 hex chars = 14 bytes) — Yggdrasil's own
    // identity guarantee. listener.go truncates display to 16 hex; we use 28
    // for tighter binding while still matching reality of the protocol.
    const PEER_PREFIX_LEN = 28;
    const fromPrefix = envelope.peer.slice(0, PEER_PREFIX_LEN).toLowerCase();
    const expectPrefix = peer.slice(0, PEER_PREFIX_LEN).toLowerCase();
    if (fromPrefix !== expectPrefix) {
      logError("execution.peer_mismatch", { from: envelope.peer, expected: peer, requestId: envelope.payload.requestId });
      continue;
    }

    const msg = envelope.payload;

    if (msg.kind !== "propose") {
      // Receipts/replies destined for the signal node land here in single-host
      // demos — drop quietly, do not reject.
      continue;
    }

    if (seenRequestIds.has(msg.requestId)) {
      logError("execution.replay_requestId", { requestId: msg.requestId });
      continue;
    }
    // outputHash dedupe disabled: deterministic LLM (temperature=0) produces
    // identical outputHash across legitimate fresh requests. Vault.usedNonces
    // is the authoritative replay guard (each tx mints randomBytes(32) nonce).
    seenRequestIds.add(msg.requestId);

    try {
      await handleProposal({ cfg, wallet, axl, peer, msg });
    } catch (e) {
      const isVerify = e instanceof VerificationError;
      logError("execution.handler_failed", {
        error: e instanceof Error ? e.message : String(e),
        stage: isVerify ? e.stage : undefined,
        requestId: msg.requestId,
      });
      try {
        await axl.send(peer, {
          requestId: msg.requestId,
          kind: "reply",
          decision: "reject",
          chatId: msg.chatId,
          timestamp: Math.floor(Date.now() / 1000),
        });
      } catch (sendErr) {
        logError("execution.reject_send_failed", {
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logError("execution.fatal", { error: msg });
    process.exit(1);
  });
}
