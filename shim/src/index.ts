// KeeperHub <-> AXL HTTP shim entrypoint. Implemented in P8.
import type { ShimRequest } from "@argus/shared";
import { loadEnv } from "@argus/shared";

export type ShimBootstrap = { env: ReturnType<typeof loadEnv>; store: Map<string, ShimRequest> };
