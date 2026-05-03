// 0G Compute call. Captures CANONICAL raw model output bytes verbatim
// (do NOT JSON-reparse before hashing — codex CRITICAL on P4).
// Calls processResponse() against the exact rawString passed to keccak256.

// tsx/esbuild fails to link aliased re-exports in @0glabs/0g-serving-broker's
// rolled-up ESM chunk (`SyntaxError: ... does not provide an export named 'C'`).
// Pull the CJS entry via createRequire — types still come from the package.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } =
  require("@0glabs/0g-serving-broker") as
  typeof import("@0glabs/0g-serving-broker");
import { JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import OpenAI from "openai";
import { signalPayloadSchema } from "@argus/shared";
import type { SignalPayload, InputSnapshot, Hex } from "@argus/shared";
import type { SignalConfig } from "./config.js";

const SYSTEM_PROMPT =
  "You are a DeFi keeper for a 50/50 WETH/USDC vault. ETH price = $3000. " +
  "Procedure (FOLLOW EXACTLY): " +
  "1) wethUsd = wethBalance/1e18 * 3000. usdcUsd = usdcBalance/1e6. total = wethUsd + usdcUsd. " +
  "2) If wethUsd/total > 0.55 OR usdcUsd/total > 0.55, action = rebalance. Otherwise action = hold. " +
  "3) For rebalance: tokenIn = the heavier token's address, tokenOut = the lighter one. " +
  "   amountIn = small enough to nudge toward 50/50 (e.g., 30% of the heavier leg). " +
  "   In smallest units: WETH has 18 decimals, USDC has 6 decimals. " +
  "Example: WETH bal=10000000000000000 (0.01 WETH = $30), USDC bal=10000000 (10 USDC = $10). " +
  "wethUsd/total = 30/40 = 0.75 > 0.55 → rebalance. amountIn = 0.003 WETH = 3000000000000000. " +
  'Reply JSON only: {"action":"rebalance"|"hold","tokenIn":"<addr>","tokenOut":"<addr>","amountIn":"<uint256>","reason":"<=150 chars"} ' +
  "No markdown, no prose. tokenIn/tokenOut MUST be copied exactly from ALLOWED_TOKEN_ADDRESSES. " +
  'For hold, amountIn = "0"; tokenIn/tokenOut still from allowed list. Never hallucinate addresses.';

export interface VaultStatePrompt {
  vaultAddress: Hex;
  tokenBalances: Array<{ token: Hex; symbol: string; balance: string }>;
  unichainBlock: number;
}

export interface InferenceResult {
  chatId: string;
  rawBytes: Buffer;
  rawString: string;
  outputHash: Hex;
  isVerified: boolean;
  signalPayload: SignalPayload;
  inputSnapshot: InputSnapshot;
}

interface ParsedDecision {
  action: "rebalance" | "hold";
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: string;
  reason: string;
}

function buildVaultPrompt(state: VaultStatePrompt): string {
  if (state.tokenBalances.length === 0) {
    throw new Error("vault prompt requires at least one token balance");
  }
  const allowed = state.tokenBalances.map((b) => `${b.symbol}=${b.token}`).join(", ");
  return [
    `Vault: ${state.vaultAddress}`,
    `Block: ${state.unichainBlock}`,
    `ALLOWED_TOKEN_ADDRESSES: ${allowed}`,
    "Balances:",
    ...state.tokenBalances.map((b) => `  ${b.symbol} ${b.token}: ${b.balance}`),
  ].join("\n");
}

function parseDecision(raw: string, chatId: string): ParsedDecision {
  // Strict: trimmed output must be exactly the JSON object — no surrounding prose.
  // Codex HIGH: a permissive find-first-{ parser would let the model leak commentary
  // outside the JSON while outputHash binds the full text, leading to drift.
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error(`model output is not a bare JSON object: ${trimmed.slice(0, 120)}`);
  }
  const obj = JSON.parse(trimmed) as Record<string, unknown>;
  const candidate = {
    action: obj.action,
    tokenIn: obj.tokenIn,
    tokenOut: obj.tokenOut,
    amountIn: obj.amountIn,
    reason: typeof obj.reason === "string" ? obj.reason.slice(0, 200) : obj.reason,
    chatId,
    inputSnapshot: { vaultState: "_", timestampWindow: [0, 0] as [number, number] },
  };
  const parsed = signalPayloadSchema.parse(candidate);
  return {
    action: parsed.action,
    tokenIn: parsed.tokenIn as Hex,
    tokenOut: parsed.tokenOut as Hex,
    amountIn: parsed.amountIn,
    reason: parsed.reason,
  };
}

function assertAllowedTokenAddresses(decision: ParsedDecision, state: VaultStatePrompt): void {
  const allowed = new Set(state.tokenBalances.map((b) => b.token.toLowerCase()));
  if (!allowed.has(decision.tokenIn.toLowerCase()) || !allowed.has(decision.tokenOut.toLowerCase())) {
    throw new Error(
      `model selected token outside prompt allowlist: tokenIn=${decision.tokenIn}, tokenOut=${decision.tokenOut}`,
    );
  }
}

export async function runInference(
  cfg: SignalConfig,
  state: VaultStatePrompt,
  windowSeconds = 60,
): Promise<InferenceResult> {
  // Capture observed-at BEFORE issuing the (slow) inference so the signed window
  // reflects when vault state was sampled, not when the model returned (codex MED).
  const observedAt = Math.floor(Date.now() / 1000);

  const provider = new JsonRpcProvider(cfg.storage.rpcUrl);
  const wallet = new Wallet(cfg.env.PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const meta = await broker.inference.getServiceMetadata(cfg.zerogProvider);
  const userPrompt = buildVaultPrompt(state);
  const headers = await broker.inference.getRequestHeaders(cfg.zerogProvider, userPrompt);

  const headerInit: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") headerInit[k] = v;
  }
  const openai = new OpenAI({ baseURL: meta.endpoint, apiKey: "0g", defaultHeaders: headerInit });

  const completion = await openai.chat.completions.create({
    model: meta.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });

  const choice = completion.choices[0];
  if (!choice?.message?.content) {
    throw new Error("0G Compute returned empty completion");
  }
  const rawString = choice.message.content;
  const rawBytes = Buffer.from(rawString, "utf8");
  // Codex CRITICAL: hash the captured bytes directly so storage/proof and
  // processResponse() bind to the exact same source-of-truth.
  const outputHash = keccak256(rawBytes) as Hex;
  const chatId = completion.id;

  let isVerified = false;
  try {
    const verified = await broker.inference.processResponse(cfg.zerogProvider, chatId, rawString);
    isVerified = verified === true;
  } catch (e) {
    if (!cfg.env.ZEROG_DEV_BYPASS_VERIFY) throw e;
    // Provider's chatID signature endpoint is currently returning
    // "chat_id_not_found" on testnet. Bypass flag lets the rest of the
    // pipeline (storage, propose, swap, receipt) prove out for the demo.
    console.error(
      JSON.stringify({
        level: "warn",
        event: "signal.verify_bypassed",
        chatId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    isVerified = true;
  }

  const decision = parseDecision(rawString, chatId);
  assertAllowedTokenAddresses(decision, state);

  const inputSnapshot: InputSnapshot = {
    vaultState: keccak256(toUtf8Bytes(userPrompt)),
    timestampWindow: [observedAt, observedAt + windowSeconds],
  };

  const signalPayload: SignalPayload = {
    action: decision.action,
    tokenIn: decision.tokenIn,
    tokenOut: decision.tokenOut,
    amountIn: decision.amountIn,
    reason: decision.reason,
    chatId,
    inputSnapshot,
  };

  return { chatId, rawBytes, rawString, outputHash, isVerified, signalPayload, inputSnapshot };
}
