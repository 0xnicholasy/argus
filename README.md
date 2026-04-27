# Argus

**Verifiable AI keeper that watches your DeFi positions and executes swaps — trustlessly.**

ETHGlobal Open Agents 2026 submission · Verifiable AI Agent track.

## What It Does

2-node Gensyn AXL swarm orchestrated by KeeperHub. Signal node runs 0G Compute TEEML (verifiable LLM inference) to decide rebalance strategy, writes to 0G Storage. Execution node reads, verifies TEE attestation, executes a swap via Uniswap Universal Router on Unichain Sepolia. Agent identified via ENS subname (Namestone). Paid via x402.

## Stack

- **TypeScript** (Node ≥20) — signal, execution, KeeperHub shim
- **Foundry** (Solidity) — vault contract
- **Go** — `kh` CLI (KeeperHub dependency)

## Chains

| Chain | Role |
|-------|------|
| Ethereum Sepolia | ENS `.eth` ownership (Namestone parent) |
| Base Sepolia | x402 USDC payments to KeeperHub |
| Unichain Sepolia | Vault contract + Uniswap Universal Router swap |
| 0G Galileo testnet | 0G Compute (TEEML) + 0G Storage |

Single signer key reused across all chains.

## Layout

```
argus/
  contracts/    # vault contract (Foundry)
  signal/       # AXL Node A — 0G strategy inference
  execution/    # AXL Node B — verify + Uniswap swap
  shim/         # KeeperHub <-> AXL HTTP adapter
  workflow/     # KeeperHub workflow definition
  scripts/      # deploy, fund, demo
```

## Setup

```bash
cp .env.example .env
# fill in keys
npm install
forge install
```

## Conventions

- TypeScript: no `any`/`unknown` without justification, no `// eslint-disable`
- Conventional commits, grouped by feature
- All secrets in `.env` (gitignored). `.env.example` documents required vars.
- No emoji in source files.

## License

MIT
