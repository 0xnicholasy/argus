// Signal node config: env loading + AXL endpoint constants.
// Node A binds locally; tcp_port:7000 mandatory (matches 04-axl-multinode/findings.md).

import { loadEnv, type Env } from "@argus/shared";

export interface SignalConfig {
  env: Env;
  zerogProvider: `0x${string}`;
  zerogModel: string;
  axl: {
    apiAddr: string;
    listenPort: number;
    tcpPort: number;
  };
  storage: {
    indexerUrl: string;
    rpcUrl: string;
  };
}

const ZEROG_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

export function loadSignalConfig(source: NodeJS.ProcessEnv = process.env): SignalConfig {
  const env = loadEnv(source);
  if (!env.ZEROG_PROVIDER_ADDRESS) {
    throw new Error("ZEROG_PROVIDER_ADDRESS required for signal node (run scripts/setup-0g.ts first)");
  }
  return {
    env,
    zerogProvider: env.ZEROG_PROVIDER_ADDRESS as `0x${string}`,
    zerogModel: env.ZEROG_MODEL,
    axl: {
      apiAddr: source.AXL_NODE_A_API ?? "127.0.0.1:9002",
      listenPort: 9101,
      tcpPort: 7000,
    },
    storage: {
      indexerUrl: source.ZEROG_INDEXER_URL ?? ZEROG_INDEXER_URL,
      rpcUrl: env.ZEROG_RPC,
    },
  };
}
