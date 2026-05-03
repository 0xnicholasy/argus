// Verification chain (codex CRITICAL — strengthened in P3/P4):
//   1. Fetch envelope bytes from 0G Storage at storageRoot.
//   2. base64-decode rawBytesB64; assert keccak256(bytes) == outputHash.
//   3. Re-run processResponse(provider, chatId, rawString) — must be true.
//   4. ONLY THEN trust the parsed signalPayload projection inside the envelope.
// Verifying against the exact stored bytes (not re-serialized JSON) is the whole
// point of persisting rawBytesB64 verbatim.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "@0glabs/0g-ts-sdk";
// tsx/esbuild fails to link aliased re-exports in 0g-serving-broker's ESM
// chunk; pull the CJS entry via createRequire (same workaround as signal/infer).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } =
  require("@0glabs/0g-serving-broker") as
  typeof import("@0glabs/0g-serving-broker");
import { JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { parseStorageEnvelope, signalPayloadSchema } from "@argus/shared";
import type { Hex, SignalPayload, StorageEnvelope } from "@argus/shared";
import type { ExecutionConfig } from "./config.js";

export interface VerifyInput {
  storageRoot: string;
  outputHash: Hex;
  chatId: string;
}

export interface VerifyResult {
  envelope: StorageEnvelope;
  rawString: string;
  rawBytes: Buffer;
  isVerified: boolean;
  // Authoritative payload — parsed from the exact bytes that were hashed and
  // TEE-verified. Use THIS for swap params, NOT envelope.signalPayload (which is a
  // projection that could drift from rawString without breaking outputHash —
  // codex CRITICAL).
  signalPayload: SignalPayload;
}

export class VerificationError extends Error {
  constructor(message: string, public readonly stage: "fetch" | "hash" | "tee" | "schema") {
    super(message);
    this.name = "VerificationError";
  }
}

async function downloadEnvelope(cfg: ExecutionConfig, storageRoot: string): Promise<Buffer> {
  const indexer = new Indexer(cfg.zerog.indexerUrl);
  const dir = mkdtempSync(join(tmpdir(), "argus-exec-"));
  const path = join(dir, "envelope.json");
  const tryFallback = (reason: string): Buffer => {
    if (process.env.STORAGE_FALLBACK_ON_FAIL !== "1") {
      throw new VerificationError(`0G Storage download failed: ${reason}`, "fetch");
    }
    const fbDir = process.env.STORAGE_FALLBACK_DIR ?? "/tmp/argus-storage";
    const fbPath = join(fbDir, `${storageRoot}.json`);
    try {
      const buf = readFileSync(fbPath);
      console.error(JSON.stringify({
        level: "warn",
        event: "execution.storage_fallback_read",
        storageRoot,
        reason,
        fallbackPath: fbPath,
      }));
      return buf;
    } catch (fbErr) {
      const m = fbErr instanceof Error ? fbErr.message : String(fbErr);
      throw new VerificationError(`0G Storage download failed: ${reason}; fallback read failed: ${m}`, "fetch");
    }
  };
  try {
    let err: Error | null = null;
    try {
      err = await indexer.download(storageRoot, path, true);
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }
    if (err !== null) return tryFallback(err.message);
    try {
      return readFileSync(path);
    } catch (rfErr) {
      const m = rfErr instanceof Error ? rfErr.message : String(rfErr);
      return tryFallback(m);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function verifyEnvelope(cfg: ExecutionConfig, input: VerifyInput): Promise<VerifyResult> {
  const fileBytes = await downloadEnvelope(cfg, input.storageRoot);

  // The downloaded file is JSON-serialized envelope. Parse + zod-validate before
  // touching any field (codex HIGH on signal P4).
  let envelope: StorageEnvelope;
  try {
    envelope = parseStorageEnvelope(JSON.parse(fileBytes.toString("utf8")));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new VerificationError(`envelope schema invalid: ${msg}`, "schema");
  }

  if (envelope.outputHash !== input.outputHash) {
    throw new VerificationError(
      `envelope.outputHash ${envelope.outputHash} != message.outputHash ${input.outputHash}`,
      "hash",
    );
  }
  if (envelope.chatId !== input.chatId) {
    throw new VerificationError(
      `envelope.chatId ${envelope.chatId} != message.chatId ${input.chatId}`,
      "schema",
    );
  }

  const rawBytes = Buffer.from(envelope.rawBytesB64, "base64");
  const computed = keccak256(rawBytes) as Hex;
  if (computed !== input.outputHash) {
    throw new VerificationError(
      `keccak256(rawBytes) ${computed} != outputHash ${input.outputHash}`,
      "hash",
    );
  }
  const rawString = rawBytes.toString("utf8");

  // processResponse() must run against the exact same string that was hashed.
  const provider = new JsonRpcProvider(cfg.zerog.rpcUrl);
  const wallet = new Wallet(cfg.env.PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  let isVerified = false;
  try {
    const verified = await broker.inference.processResponse(cfg.zerogProvider, input.chatId, rawString);
    isVerified = verified === true;
  } catch (e) {
    if (!process.env.ZEROG_DEV_BYPASS_VERIFY) {
      throw new VerificationError(
        `processResponse() threw for chatId=${input.chatId}: ${e instanceof Error ? e.message : String(e)}`,
        "tee",
      );
    }
    console.error(JSON.stringify({
      level: "warn",
      event: "execution.verify_bypassed",
      chatId: input.chatId,
      error: e instanceof Error ? e.message : String(e),
    }));
    isVerified = true;
  }
  if (!isVerified) {
    throw new VerificationError(
      `processResponse() returned false for chatId=${input.chatId}`,
      "tee",
    );
  }

  // Re-parse signalPayload directly from rawString (the bytes that were hashed +
  // TEE-verified). Trusting envelope.signalPayload would let a tampered projection
  // change tokens/amount while outputHash still matches the (separate) rawBytes.
  const trimmed = rawString.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new VerificationError(`rawString is not a bare JSON object`, "schema");
  }
  let modelOutput: Record<string, unknown>;
  try {
    modelOutput = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new VerificationError(`rawString JSON parse failed: ${m}`, "schema");
  }
  const candidate = {
    action: modelOutput.action,
    tokenIn: modelOutput.tokenIn,
    tokenOut: modelOutput.tokenOut,
    amountIn: modelOutput.amountIn,
    reason: typeof modelOutput.reason === "string" ? modelOutput.reason.slice(0, 200) : modelOutput.reason,
    chatId: input.chatId,
    inputSnapshot: envelope.inputSnapshot,
  };
  let signalPayload: SignalPayload;
  try {
    signalPayload = signalPayloadSchema.parse(candidate);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new VerificationError(`rawString does not match SignalPayload schema: ${m}`, "schema");
  }

  return { envelope, rawString, rawBytes, isVerified, signalPayload };
}
