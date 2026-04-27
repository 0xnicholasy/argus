// Persist the StorageEnvelope to 0G Storage and return rootHash.
// The envelope contains rawBytes verbatim — execution node re-hashes those exact bytes.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer, ZgFile } from "@0glabs/0g-ts-sdk";
import { JsonRpcProvider, Wallet, type Signer } from "ethers";
import type { Hex, InputSnapshot, SignalPayload, StorageEnvelope } from "@argus/shared";
import type { SignalConfig } from "./config.js";

export interface UploadResult {
  storageRoot: string;
  txHash: string;
}

export interface PersistInput {
  rawBytes: Buffer;
  outputHash: Hex;
  signalPayload: SignalPayload;
  chatId: string;
  inputSnapshot: InputSnapshot;
}

export async function persistEnvelope(cfg: SignalConfig, input: PersistInput): Promise<UploadResult> {
  const envelope: StorageEnvelope = {
    rawBytesB64: input.rawBytes.toString("base64"),
    outputHash: input.outputHash,
    signalPayload: input.signalPayload,
    chatId: input.chatId,
    inputSnapshot: input.inputSnapshot,
  };
  const json = JSON.stringify(envelope);
  const { chatId } = input;

  const dir = mkdtempSync(join(tmpdir(), "argus-signal-"));
  const path = join(dir, `${chatId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  writeFileSync(path, json, { encoding: "utf8" });

  try {
    const provider = new JsonRpcProvider(cfg.storage.rpcUrl);
    const wallet = new Wallet(cfg.env.PRIVATE_KEY, provider);
    const indexer = new Indexer(cfg.storage.indexerUrl);
    const file = await ZgFile.fromFilePath(path);
    // 0g-ts-sdk's Indexer.d.ts pulls ethers Signer from lib.commonjs while consumer
    // resolves lib.esm — same runtime class, but TS treats their private brands as
    // distinct. Cast through a structural alias that drops the brand.
    type UploadFn = (
      f: ZgFile,
      rpc: string,
      s: Signer,
    ) => Promise<[{ txHash: string; rootHash: string }, Error | null]>;
    const upload = indexer.upload.bind(indexer) as unknown as UploadFn;
    const [result, err] = await upload(file, cfg.storage.rpcUrl, wallet);
    if (err !== null) throw new Error(`0G Storage upload failed: ${err.message}`);
    return { storageRoot: result.rootHash, txHash: result.txHash };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
