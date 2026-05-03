export const SHIM_URL = import.meta.env.VITE_SHIM_URL ?? "http://127.0.0.1:8790";

export const UNICHAIN_RPC =
  import.meta.env.VITE_UNICHAIN_RPC ?? "https://sepolia.unichain.org";

export const VAULT_ADDRESS =
  (import.meta.env.VITE_VAULT_ADDRESS as string | undefined) ??
  "0x4b0D02a5B71a998f3717AB755412dDdC1040374d";

export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
export const USDC_ADDRESS = "0x31d0220469e10c4E71834a79b1f276d740d3768F";

export const EXPLORER = "https://unichain-sepolia.blockscout.com";
