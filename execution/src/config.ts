// Execution node config: env loading + AXL endpoint constants + chain wiring.
// Node B peers back to Node A; tcp_port:7000 mandatory both sides.

import { loadEnv, requireVaultAddress, type Env, type Hex } from "@argus/shared";

export interface ExecutionConfig {
  env: Env;
  vaultAddress: Hex;
  universalRouter: Hex;
  zerogProvider: Hex;
  zerogModel: string;
  unichain: {
    rpcUrl: string;
    rpcBackup?: string;
    chainId: number;
  };
  zerog: {
    rpcUrl: string;
    indexerUrl: string;
  };
  axl: {
    apiAddr: string;
    listenPort: number;
    tcpPort: number;
  };
  swap: {
    feeTier: number;
    slippageBps: bigint;
    deadlineSeconds: number;
  };
}

const ZEROG_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";
const UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
const DEFAULT_FEE_TIER = 3000;
const DEFAULT_SLIPPAGE_BPS = 50n;
const DEFAULT_DEADLINE_SECONDS = 300;

export function loadExecutionConfig(source: NodeJS.ProcessEnv = process.env): ExecutionConfig {
  const env = loadEnv(source);
  if (!env.ZEROG_PROVIDER_ADDRESS) {
    throw new Error("ZEROG_PROVIDER_ADDRESS required for execution node (run scripts/setup-0g.ts first)");
  }
  const vaultAddress = requireVaultAddress(env);

  return {
    env,
    vaultAddress,
    universalRouter: env.UNIVERSAL_ROUTER as Hex,
    zerogProvider: env.ZEROG_PROVIDER_ADDRESS as Hex,
    zerogModel: env.ZEROG_MODEL,
    unichain: {
      rpcUrl: env.UNICHAIN_SEPOLIA_RPC,
      rpcBackup: env.UNICHAIN_SEPOLIA_RPC_BACKUP,
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    },
    zerog: {
      rpcUrl: env.ZEROG_RPC,
      indexerUrl: source.ZEROG_INDEXER_URL ?? ZEROG_INDEXER_URL,
    },
    axl: {
      apiAddr: source.AXL_NODE_B_API ?? "127.0.0.1:9003",
      listenPort: 9102,
      tcpPort: 7000,
    },
    swap: {
      feeTier: source.EXEC_FEE_TIER ? Number(source.EXEC_FEE_TIER) : DEFAULT_FEE_TIER,
      slippageBps: source.EXEC_SLIPPAGE_BPS ? BigInt(source.EXEC_SLIPPAGE_BPS) : DEFAULT_SLIPPAGE_BPS,
      deadlineSeconds: source.EXEC_DEADLINE_SECONDS ? Number(source.EXEC_DEADLINE_SECONDS) : DEFAULT_DEADLINE_SECONDS,
    },
  };
}
