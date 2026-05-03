/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHIM_URL?: string;
  readonly VITE_UNICHAIN_RPC?: string;
  readonly VITE_VAULT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
