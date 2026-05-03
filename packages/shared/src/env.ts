// Centralized env schema. Consumers call loadEnv() once at startup.
// Schema is partial-by-section: signal/execution/shim each only need a subset.

import { z } from "zod";

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/, "must be 0x-prefixed hex");
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x address");
const url = z.string().url();
const nonEmpty = z.string().min(1);

// Treat blank strings as absent so .env.example placeholders (KEY=) parse cleanly
// for optional/defaulted fields. Required fields still error if blank.
const blankToUndef = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

export const envSchema = z.object({
  PRIVATE_KEY: hex.refine((v) => v.length === 66, "PRIVATE_KEY must be 32 bytes"),

  SEPOLIA_RPC: url,
  BASE_SEPOLIA_RPC: url,
  UNICHAIN_SEPOLIA_RPC: url,
  ZEROG_RPC: url,

  SEPOLIA_RPC_BACKUP: blankToUndef(url.optional()),
  BASE_SEPOLIA_RPC_BACKUP: blankToUndef(url.optional()),
  UNICHAIN_SEPOLIA_RPC_BACKUP: blankToUndef(url.optional()),

  ZEROG_PROVIDER_ADDRESS: blankToUndef(addr.optional()),
  ZEROG_MODEL: blankToUndef(nonEmpty.default("qwen/qwen-2.5-7b-instruct")),

  KH_API_KEY: blankToUndef(nonEmpty.optional()),
  KH_WORKFLOW_ID: blankToUndef(nonEmpty.optional()),
  KH_BIN: blankToUndef(nonEmpty.optional()),

  ENS_NAME: blankToUndef(nonEmpty.optional()),
  NAMESTONE_API_KEY: blankToUndef(nonEmpty.optional()),
  NAMESTONE_PARENT_DOMAIN: blankToUndef(nonEmpty.optional()),
  NAMESTONE_SUBNAME: blankToUndef(nonEmpty.default("rebalancer")),
  REPO_URL: blankToUndef(url.optional()),
  ERC8004_STATUS: blankToUndef(nonEmpty.default("pending")),

  UNIVERSAL_ROUTER: blankToUndef(addr.default("0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d")),
  VAULT_ADDRESS: blankToUndef(addr.optional()),

  // Signal worker pushes receipts/replies to this URL (D1: webhook-based shim).
  // Optional at boot — if blank, signal logs and drops (lets local single-shot
  // runs succeed without a shim deployed).
  SHIM_URL: blankToUndef(url.optional()),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}

export function requireVaultAddress(env: Env): `0x${string}` {
  if (!env.VAULT_ADDRESS) {
    throw new Error("VAULT_ADDRESS required (deploy ArgusVault and set in .env)");
  }
  return env.VAULT_ADDRESS as `0x${string}`;
}
