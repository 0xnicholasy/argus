// AXL Node B entrypoint. Implemented in P6.
import type { SwarmMessage, VaultSwapTag } from "@argus/shared";
import { buildDomain, loadEnv } from "@argus/shared";

export type ExecutionBootstrap = {
  env: ReturnType<typeof loadEnv>;
  domainBuilder: typeof buildDomain;
  acceptedKinds: SwarmMessage["kind"][];
  swapTagShape: keyof VaultSwapTag;
};
