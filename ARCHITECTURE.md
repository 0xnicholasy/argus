# Argus Architecture

Skeleton — fleshed out as phases land.

## Component Map

```
KeeperHub workflow (workflow/workflow.json)
  -> Shim (shim/) HTTP: POST /trigger, GET /status/:id
       -> AXL Node A "Signal" (signal/)
            - 0G Compute TEEML inference
            - persists raw output bytes + chatId to 0G Storage
            - emits SwarmMessage { storageRoot, outputHash } to Node B
       -> AXL Node B "Execution" (execution/)
            - fetches bytes from 0G Storage
            - asserts keccak256(bytes) == outputHash
            - re-runs processResponse(provider, chatId, rawString) -> true
            - EIP-712 signs VaultSwapTag
            - calls ArgusVault.executeRebalance (contracts/)
                 -> Uniswap Universal Router on Unichain Sepolia
```

## Workspaces

| Path | Purpose |
|------|---------|
| `signal/` | AXL Node A — 0G Compute + 0G Storage writer |
| `execution/` | AXL Node B — verifier + Uniswap swap caller |
| `shim/` | KeeperHub HTTP adapter, AXL send/recv bridge |
| `packages/shared/` | Types, ABIs, EIP-712 domain, env schema (frozen in P3) |
| `contracts/` | ArgusVault.sol + Foundry tests |
| `workflow/` | KeeperHub workflow JSON |
| `scripts/` | Setup, funding, demo scripts |

## Chains

| Chain | Role |
|-------|------|
| Ethereum Sepolia | ENS `.eth` ownership (Namestone parent) |
| Base Sepolia | x402 USDC payments to KeeperHub |
| Unichain Sepolia (1301) | Vault contract + Universal Router |
| 0G Galileo testnet | 0G Compute + 0G Storage |

## Verification Chain

Off-chain: `processResponse(provider, chatId, exact-raw-bytes)` returns `true`.
On-chain: `RebalanceExecuted(nonce, chatIdHash, outputHash, ...)` event.
DA: `storageRoot` published to 0G Storage.

## EIP-712 Domain (frozen P3)

```
{ name: "ArgusVault", version: "1", chainId: 1301, verifyingContract: VAULT_ADDRESS }
SwapTag { bytes32 chatIdHash, bytes32 outputHash, uint256 nonce, bytes32 requestId, address tokenIn, address tokenOut, uint256 amountIn }
```
