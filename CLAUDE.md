# Argus — Verifiable AI DeFi Keeper

**Hackathon**: ETHGlobal Open Agents 2026
**Category**: Verifiable AI Agent
**Tagline**: Autonomous keeper that watches your DeFi positions and executes swaps — trustlessly.

## What It Does

2-node Gensyn AXL swarm orchestrated by KeeperHub. Signal node runs 0G Compute TEEML (verifiable LLM inference) to decide rebalance strategy → writes to 0G Storage → Execution node reads, verifies TEE attestation, executes Uniswap swap on Unichain Sepolia. Agent identified via ENS subname (Namestone). Paid via x402.

## Stack

- **TypeScript** (Node ≥20): signal, execution, shim (KeeperHub adapter)
- **Foundry** (Solidity): vault contract
- **Go**: `kh` CLI (KeeperHub dependency)

## Chains

| Chain | Role |
|-------|------|
| Ethereum Sepolia | ENS `.eth` ownership (Namestone parent) |
| Base Sepolia | x402 USDC payments to KeeperHub |
| Unichain Sepolia | Vault contract + Uniswap Universal Router |
| 0G Galileo testnet | 0G Compute + 0G Storage |

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

## Coding Rules

- TypeScript: no `any`/`unknown` without justification. No `// eslint-disable`.
- No emoji in source files (Linux rendering).
- Never read `.env` — only `.env.example`.
- Conventional commits, grouped by feature/fix.
- Run `tsc --noEmit` + lint before commit.

## Verify Setup

Run `npm run check-gates` to verify all 9 prerequisites (Sepolia ENS ownership, Namestone API key, kh CLI auth, chain balances on Base Sepolia/0G/Unichain, backup RPCs, and config vars). Gates 8–9 (app config vars and vault deploy) are expected to fail until the app build progresses; gates 1–7 must pass before proceeding.

## Scope

This repo contains ship-ready build code only. No progress tracking, planning docs, research notes, or session memory — those live outside this repo.
