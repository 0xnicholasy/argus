export const SHIM_URL = import.meta.env.VITE_SHIM_URL ?? "http://127.0.0.1:8790";

export const UNICHAIN_RPC =
  import.meta.env.VITE_UNICHAIN_RPC ?? "https://sepolia.unichain.org";

export const VAULT_ADDRESS =
  (import.meta.env.VITE_VAULT_ADDRESS as string | undefined) ??
  "0x4b0D02a5B71a998f3717AB755412dDdC1040374d";

export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
export const USDC_ADDRESS = "0x31d0220469e10c4E71834a79b1f276d740d3768F";

export const EXPLORER = "https://unichain-sepolia.blockscout.com";

// Demo-mode disclosure flags. Surfaced as honest amber chips so judges see the
// bypass instead of finding it in logs. Default ON because the recorded demo
// runs with all three (see argus/docs/DEMO.md section 0b).
function flag(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true";
}

export const FLAGS = {
  verifyBypassed: flag(import.meta.env.VITE_DEMO_VERIFY_BYPASSED as string | undefined, true),
  storageFallback: flag(import.meta.env.VITE_DEMO_STORAGE_FALLBACK as string | undefined, true),
  quoterSkipped: flag(import.meta.env.VITE_DEMO_QUOTER_SKIPPED as string | undefined, true),
};

// Static sponsor stamps. Placeholders OK — they identify the sponsor on screen
// without requiring extra backend wiring.
export const SPONSORS = {
  keeperhubWorkflow:
    (import.meta.env.VITE_KEEPERHUB_WORKFLOW as string | undefined) ?? "argus-keeper-local",
  ensSubname:
    (import.meta.env.VITE_AGENT_ENS as string | undefined) ?? "rebalancer.argus.eth",
  ensExplorer: "https://sepolia.app.ens.domains",
  axlNodeA:
    (import.meta.env.VITE_AXL_NODE_A as string | undefined) ??
    "daf5b5267e366fa536457100fbf556aa2b4e52f3ced8c3e250880122869fa0b5",
  axlNodeB:
    (import.meta.env.VITE_AXL_NODE_B as string | undefined) ??
    "00cf8fdb8b21a038e266cb16f4aad0e64b37734dab664a4d395a27c88050e061",
  zerogModel: "deepseek-chat-v3-0324",
};
