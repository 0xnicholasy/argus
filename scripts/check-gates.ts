// Verify all environment + chain prerequisites for Argus.
// Run: npm run check-gates

import "dotenv/config";
import { JsonRpcProvider, Wallet, formatEther, formatUnits, Contract, namehash, type BaseContract } from "ethers";

type Erc20 = BaseContract & {
  balanceOf(addr: string): Promise<bigint>;
  decimals(): Promise<bigint>;
};
type EnsRegistry = BaseContract & { owner(node: string): Promise<string> };
type NameWrapper = BaseContract & { ownerOf(id: bigint): Promise<string> };
import { execSync } from "node:child_process";

type GateResult = { gate: string; status: "PASS" | "FAIL" | "UNKNOWN"; detail: string };

const RPCS = {
  sepolia: process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia.publicnode.com",
  baseSepolia: process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
  unichainSepolia: process.env.UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org",
  zerog: process.env.ZEROG_RPC ?? "https://evmrpc-testnet.0g.ai",
};

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ENS_SEPOLIA_REGISTRY = "0x0635513f179D50A207757E05759CbD106d7dFcE8";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];
const REGISTRY_ABI = ["function owner(bytes32 node) view returns (address)"];
const WRAPPER_ABI = ["function ownerOf(uint256 id) view returns (address)"];

const MIN = {
  sepoliaEth: 0.01,
  baseSepoliaEth: 0.001,
  unichainSepoliaEth: 0.05,
  baseSepoliaUsdc: 1,
  zerogOg: 0.5,
};

async function checkBalance(rpc: string, addr: string): Promise<string | null> {
  try {
    const provider = new JsonRpcProvider(rpc);
    const bal = await provider.getBalance(addr);
    return formatEther(bal);
  } catch {
    return null;
  }
}

async function checkUsdcBase(addr: string): Promise<string | null> {
  try {
    const provider = new JsonRpcProvider(RPCS.baseSepolia);
    const c = new Contract(USDC_BASE_SEPOLIA, ERC20_ABI, provider) as unknown as Erc20;
    const [bal, dec] = await Promise.all([c.balanceOf(addr), c.decimals()]);
    return formatUnits(bal, dec);
  } catch {
    return null;
  }
}

async function checkEnsOwnership(name: string, signer: string): Promise<GateResult> {
  try {
    const provider = new JsonRpcProvider(RPCS.sepolia);
    const reg = new Contract(ENS_SEPOLIA_REGISTRY, REGISTRY_ABI, provider) as unknown as EnsRegistry;
    const node = namehash(name);
    const registryOwner = await reg.owner(node);
    if (registryOwner === "0x0000000000000000000000000000000000000000") {
      return { gate: `#1 ENS ${name} ownership`, status: "FAIL", detail: "name not registered" };
    }
    let trueOwner = registryOwner;
    if (registryOwner.toLowerCase() !== signer.toLowerCase()) {
      const wrapper = new Contract(registryOwner, WRAPPER_ABI, provider) as unknown as NameWrapper;
      try { trueOwner = await wrapper.ownerOf(BigInt(node)); } catch { /* not a wrapper */ }
    }
    const owns = trueOwner.toLowerCase() === signer.toLowerCase();
    return {
      gate: `#1 ENS ${name} ownership`,
      status: owns ? "PASS" : "FAIL",
      detail: owns ? `owned by signer (${trueOwner === registryOwner ? "registry" : "wrapper"})` : `owner=${trueOwner}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { gate: `#1 ENS ${name} ownership`, status: "UNKNOWN", detail: `lookup error: ${msg}` };
  }
}

function checkKhAuth(): GateResult {
  const khBin = process.env.KH_BIN ?? `${process.env.HOME}/go/bin/kh`;
  try {
    const out = execSync(`${khBin} auth status 2>&1`, { encoding: "utf8" }).trim();
    if (out.toLowerCase().includes("not authenticated")) {
      return { gate: "#3 kh auth login", status: "FAIL", detail: out };
    }
    return { gate: "#3 kh auth login", status: "PASS", detail: out.split("\n")[0] ?? "authenticated" };
  } catch {
    if (process.env.KH_API_KEY) {
      return { gate: "#3 kh auth login", status: "PASS", detail: "KH_API_KEY set (CI mode)" };
    }
    return { gate: "#3 kh auth login", status: "FAIL", detail: "kh CLI not on path and no KH_API_KEY" };
  }
}

function checkNamestone(): GateResult {
  if (process.env.NAMESTONE_API_KEY) {
    return { gate: "#2 Namestone signup", status: "PASS", detail: "NAMESTONE_API_KEY set" };
  }
  return { gate: "#2 Namestone signup", status: "FAIL", detail: "NAMESTONE_API_KEY not set — submit form at namestone.com/try-namestone" };
}

function checkBackupRpcs(): GateResult {
  const required = ["SEPOLIA_RPC_BACKUP", "BASE_SEPOLIA_RPC_BACKUP", "UNICHAIN_SEPOLIA_RPC_BACKUP"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) return { gate: "#7 Backup RPCs", status: "PASS", detail: "3 backups set (0G has no third-party alt)" };
  return { gate: "#7 Backup RPCs", status: "FAIL", detail: `missing: ${missing.join(", ")}` };
}

function checkAppConfig(): GateResult {
  const required = [
    "ZEROG_PROVIDER_ADDRESS",
    "ZEROG_MODEL",
    "KH_WORKFLOW_ID",
    "NAMESTONE_PARENT_DOMAIN",
    "NAMESTONE_SUBNAME",
    "UNIVERSAL_ROUTER",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) return { gate: "#8 App config vars", status: "PASS", detail: `${required.length} vars set` };
  return { gate: "#8 App config vars", status: "FAIL", detail: `missing: ${missing.join(", ")}` };
}

function checkVaultDeployed(): GateResult {
  const v = process.env.VAULT_ADDRESS;
  if (v && /^0x[a-fA-F0-9]{40}$/.test(v)) return { gate: "#9 Vault deployed", status: "PASS", detail: v };
  return { gate: "#9 Vault deployed", status: "FAIL", detail: "VAULT_ADDRESS not set (deploy via scripts/deploy-vault)" };
}

async function main(): Promise<void> {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk === "0x..." || pk.length < 10) {
    console.error("PRIVATE_KEY missing or placeholder in .env");
    process.exit(1);
  }
  const wallet = new Wallet(pk);
  const addr = wallet.address;
  console.log(`Signer: ${addr}\n`);

  const [sepEth, baseEth, uniEth, ogEth, baseUsdc] = await Promise.all([
    checkBalance(RPCS.sepolia, addr),
    checkBalance(RPCS.baseSepolia, addr),
    checkBalance(RPCS.unichainSepolia, addr),
    checkBalance(RPCS.zerog, addr),
    checkUsdcBase(addr),
  ]);

  const ensName = process.env.ENS_NAME;
  const gate1: GateResult = ensName
    ? await checkEnsOwnership(ensName, addr)
    : {
        gate: "#1 Sepolia gas (set ENS_NAME for ownership check)",
        status: sepEth === null ? "UNKNOWN" : Number(sepEth) >= MIN.sepoliaEth ? "PASS" : "FAIL",
        detail: sepEth === null ? "RPC error" : `${sepEth} ETH (need >=${MIN.sepoliaEth})`,
      };

  const results: GateResult[] = [
    gate1,
    checkNamestone(),
    checkKhAuth(),
    {
      gate: "#4 Base Sepolia USDC",
      status: baseUsdc === null ? "UNKNOWN" : Number(baseUsdc) >= MIN.baseSepoliaUsdc ? "PASS" : "FAIL",
      detail: baseUsdc === null ? "RPC error" : `${baseUsdc} USDC (need >=${MIN.baseSepoliaUsdc}); gas: ${baseEth ?? "?"} ETH`,
    },
    {
      gate: "#5 0G Galileo OG",
      status: ogEth === null ? "UNKNOWN" : Number(ogEth) >= MIN.zerogOg ? "PASS" : "FAIL",
      detail: ogEth === null ? "RPC error" : `${ogEth} OG (need >=${MIN.zerogOg})`,
    },
    {
      gate: "#6 Unichain Sepolia ETH",
      status: uniEth === null ? "UNKNOWN" : Number(uniEth) >= MIN.unichainSepoliaEth ? "PASS" : "FAIL",
      detail: uniEth === null ? "RPC error" : `${uniEth} ETH (need >=${MIN.unichainSepoliaEth})`,
    },
    checkBackupRpcs(),
    checkAppConfig(),
    checkVaultDeployed(),
  ];

  console.log("Gate Status:");
  for (const r of results) {
    const icon = r.status === "PASS" ? "[PASS]" : r.status === "FAIL" ? "[FAIL]" : "[ ?  ]";
    console.log(`  ${icon} ${r.gate}\n         ${r.detail}`);
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n${passed}/${results.length} gates PASS`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
