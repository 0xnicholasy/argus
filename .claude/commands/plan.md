---
description: Argus development planner — phased build, dependencies, scope cuts. Reviewed by planner + codex.
argument-hint: "[next | status | <phase-number>]"
---

# /plan — Argus Build Planner

Source-of-truth for the Argus build. Companion docs in `../08-keeper-agent-design/`:
- `PRE-FLIGHT-CHECKLIST.md` — non-code user-action gates + SPOFs (read first)
- `README.md` — scaffold for `ARCHITECTURE.md`, `gate-2-prompts.md`, `gate-3-spike.ts`, `KILL-CONDITIONS.md`

Verified building blocks live in `../01-0g-sdk/findings.md`, `../02-uniswap-v4/findings.md`, `../04-axl-multinode/`, `../05-ens-namestone/`, `../06-erc7857-inft/`, `../07-keeperhub-deeper/`. Treat the plan as derived from these — do not re-research.

---

## Command Behavior

| Arg | Output |
|-----|--------|
| (none) | `status` then `next` |
| `next` | Highest-priority uncompleted step: phase #, file path, acceptance criterion |
| `status` | One line per phase: #, name, status, hours remaining, plus today vs. hard-date checkpoints |
| `<n>` (1-15) | Full drill-down for phase n: files, interfaces, test approach, gotchas |

Cut decisions read from the static **Scope-Cut Ladder** section below — no command branch.

---

## Context Snapshot

- **Hackathon ends 2026-05-06.** Today 2026-04-27 = Day 3. **9 days remaining.**
- **Hard-date checkpoints** (re-plan immediately if missed):
  - **Apr 29 EOD** — critical-path ≥50% (P1–P4 done, P6 in progress)
  - **May 1 EOD** — full e2e dry-run (`bash scripts/demo.sh` returns swap tx)
  - **May 4 EOD** — submission lock (FEEDBACK.md sent, video recorded)
- **Single signer key** across Sepolia (ENS) / Base Sepolia (x402) / Unichain Sepolia (vault+swap) / 0G Galileo (Compute+Storage).

### Verified building blocks

| Component | Status | Key fact |
|-----------|--------|----------|
| AXL 2-node | functionality verified, **remote-host latency NOT verified** | `tcp_port: 7000` mandatory both sides; p95 283ms loopback only |
| 0G Compute SDK | functionality verified, **demo latency NOT verified** | `deepseek-chat-v3-0324` TeeML; `processResponse(provider, chatId, content)` returns boolean; p50 10–20s, worst 60–180s |
| 0G Storage | verified | `@0gfoundation/0g-ts-sdk` — gateway `https://storage-testnet.0g.ai` |
| Uniswap Universal Router | verified | Unichain Sepolia `0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d`; forge tests pass |
| KeeperHub `kh` CLI | verified | v0.3.0; workflow JSON; needs `kh auth login` (user) |
| ENS Namestone | conditional | Sepolia .eth + form approval (~24h); CCIP-Read async — **cannot resolve sync on-chain**; use EIP-712 sig from EOA for vault gating |
| ERC-7857 iNFT | conditional | Reference impl exists, MockOracle for demo; 4h time-box |

### Pre-flight gates (block testing — see `../08-keeper-agent-design/PRE-FLIGHT-CHECKLIST.md`)

Sepolia ENS .eth · Namestone form (24h lag) · `kh auth login` · Base USDC fund · 0G Galileo 3 OG · Unichain Sepolia ETH.

---

## Phase Table

| # | Phase | Dir | Deliverable | Acceptance | Est. | Blocks | Sponsor |
|---|-------|-----|-------------|-----------|------|--------|---------|
| 1 | Scaffold | `argus/` | `package.json`, `tsconfig.base.json`, workspaces (signal/execution/shim), Foundry root, `ARCHITECTURE.md` skeleton | `tsc --noEmit` + `forge build` pass | 2h | all | — |
| 2 | Vault Contract | `contracts/` | `ArgusVault.sol` w/ EIP-712 sig + nonce dedup; deployed to Unichain Sepolia | `forge test` 100%; addr in `.env` | 4h | 3,6 | Uniswap |
| 3 | **Interface Freeze** | `argus/` + `packages/shared/` | ABI export, typed TS client (typechain), `SwarmMessage`/`SignalPayload`/`VaultSwapTag` types, EIP-712 domain const, env schema (zod) | `tsc` passes in all workspaces consuming shared types | 1h | 4,5,6 | — |
| 4 | Signal Node | `signal/` | AXL Node A: 0G Compute call, persists **canonical raw model output bytes** + `chatId` to 0G Storage, sends AXL message with `storageRoot` + `outputHash` | log shows `isVerified:true` + `storageRoot` | 6h | 6 | 0G + Gensyn |
| 5 | Execution Prereqs | `scripts/` | Token funding script: vault funded with test WETH/USDC, approvals set, dry-run quote via Universal Router `quote()` succeeds | `cast call` returns expected `amountOut` | 1.5h | 6 | Uniswap |
| 6 | Execution Node | `execution/` | AXL Node B: pulls **exact bytes** from 0G Storage, verifies `keccak256(bytes)==outputHash`, calls `processResponse()` against same bytes, EIP-712 signs, calls `Vault.executeRebalance` | swap tx confirmed on Uniscan | 6h | 7 | Uniswap+0G+Gensyn |
| 7 | AXL Wiring | `scripts/` | `start-nodes.sh` + `test-round-trip.sh`; `tcp_port:7000` both configs | round-trip exits 0; remote-host latency logged | 3h | 8 | Gensyn |
| 8 | KeeperHub Shim | `shim/` | Express HTTP: `POST /trigger` (202+`requestId`), `GET /status/:id`; in-memory dedup `Map<requestId>`; 60s poll budget | KeeperHub workflow drives shim end-to-end | 5h | 9 | KeeperHub |
| 9 | KeeperHub Workflow | `workflow/` | `workflow.json` registered (`kh wf create` + `go-live`); cron+manual triggers | `kh wf run --wait` returns swap tx hash | 3h | 14 | KeeperHub |
| 10 | **Uniswap FEEDBACK.md** | repo root | >200 words; submitted via Uniswap form | file exists + form receipt screenshot | 1h | — | Uniswap (**mandatory**) |
| 11 | ENS Identity | `scripts/` | Namestone `setName` for `rebalancer.<parent>.eth` + text records | `viem.getEnsAddress()` resolves to agent EOA | 2h impl + 24h human gate | — | ENS |
| 12 | ERC-7857 iNFT | `contracts/` + `scripts/` | AgentNFT mint on Galileo with encrypted state | mint tx on Galileo explorer | 6h, **4h time-box** | — | 0G Track B |
| 13 | ERC-8004 Registry | `scripts/` | viem call to ERC-8004 Identity Registry w/ metadata URI (kh wallet does NOT do this — direct viem) | registration tx confirmed | 2h | — | KH stretch |
| 14 | Demo Script | `scripts/` | `pre-stage-inference.ts` writes `demo-cache.json` bound to **immutable input hash** (vault-snapshot + timestamp window); `demo.sh` chains kh+poll+narration | full dry-run <90s | 3h | — | demo gate |
| 15 | Demo UI (opt) | `ui/` | Next.js page: chatId badge, swap status, ENS card | page loads on `localhost:3000` | 6h | — | polish |
| 16 | **Cloud Deploy (AXL Option 2)** | `argus/` | `Dockerfile.shim` + `Dockerfile.axl`; `fly.shim.toml` + `fly.axl-a.toml` + `fly.axl-b.toml`; `scripts/deploy-shim.sh` + `scripts/deploy-axl.sh`; 3 Fly apps (`argus-shim`, `argus-axl-a`, `argus-axl-b`) peered via Fly 6PN; KeeperHub workflow points at `https://argus-shim.fly.dev` | `curl https://argus-shim.fly.dev/health` returns 200; `fly ssh console -a argus-shim -C 'curl argus-axl-a.internal:9002/health'` 200; `kh wf run` end-to-end returns swap tx | 4h (shim 1.5h done; axl-a/b 2h; peering+secrets 0.5h) | 9,14 | KeeperHub + Gensyn |

**Total: ~54.5h core + ~15h optional.**

---

## Critical Path

**Primary** (all 5 sponsors): `P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P14` = **36.5h** (~5 days at 7h/day). Target complete **May 1 EOD**.

**Alt path "demo-minus-ENS/iNFT"** (KeeperHub + 0G + Uniswap + Gensyn only — used if Namestone or iNFT slips): `P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P14` (same — ENS/iNFT are off critical path). Drops ~$2K EV but ships.

P4 and P5 can run in parallel after P3 freezes the interface.

---

## Daily Schedule

| Day | Date | Phases | Milestone | Hours |
|-----|------|--------|-----------|-------|
| 3 | Apr 27 | P1 + P2 start | scaffold green | 6h |
| 4 | Apr 28 | P2 finish + P3 + P4 start | vault deployed; interfaces frozen | 7h |
| 5 | Apr 29 | P4 finish + P5 + P7 | **HARD GATE: critical-path ≥50%** | 7h |
| 6 | Apr 30 | P6 + P8 start | swap tx fires from execution node | 7h |
| 7 | May 1 | P8 finish + P9 + **P10** | **HARD GATE: full e2e dry-run** | 7h |
| 8 | May 2 | P11 + P14 | demo script passes; ENS subname set | 6h |
| 9 | May 3 | P12 (4h time-box) + P13 | iNFT shipped or dropped; ERC-8004 registered | 6h |
| 10 | May 4 | P15 OR polish/harden | **HARD GATE: submission lock** | 6h |
| 11 | May 5 | buffer — fixes, video record | submission draft | 5h |
| 12 | May 6 | submit | final + Uniswap form | 2h |

---

## Per-Phase Drill-Down

### P1 — Scaffold (2h)

Files: `package.json` (npm workspaces: `signal`, `execution`, `shim`, `packages/shared`), `tsconfig.base.json` (strict, ES2022, bundler resolution), per-workspace `package.json`+`tsconfig.json`, `contracts/foundry.toml`, `workflow/workflow.json` skeleton, `ARCHITECTURE.md` skeleton, verify `.env.example`.

Acceptance: `tsc --noEmit` + `forge build` pass.

Gotchas: Node ≥20 (kh wallet). Go ≥1.25 (kh CLI).

---

### P2 — Vault Contract (4h)

Files: `contracts/src/ArgusVault.sol`, `contracts/test/ArgusVault.t.sol`, `contracts/script/DeployArgusVault.s.sol`.

Interface:

```solidity
contract ArgusVault {
  address public immutable universalRouter; // 0xf70536...
  address public immutable agentEOA;        // resolved off-chain via ENS
  mapping(uint256 => bool) public usedNonces;

  event RebalanceExecuted(
    uint256 indexed nonce,
    bytes32 indexed chatIdHash,   // keccak256(chatId string)
    bytes32 outputHash,           // keccak256(canonical 0G model bytes)
    address tokenIn, address tokenOut, uint256 amountIn,
    bytes32 requestId
  );

  function executeRebalance(
    SwapParams calldata p,
    bytes32 chatIdHash, bytes32 outputHash,
    uint256 nonce, bytes32 requestId,
    bytes calldata agentSig
  ) external;
  function deposit() external payable;
  function withdraw(uint256) external;
}
```

`agentSig` = EIP-712 over `(chatIdHash, outputHash, nonce, requestId, tokenIn, tokenOut, amountIn)`. Recover → must equal `agentEOA`.

Tests: happy-path, replay-rejected (nonce), wrong-signer, deposit/withdraw.

Gotchas: V3 swap via Universal Router `Commands.V3_SWAP_EXACT_IN = 0x00`. Do NOT attempt on-chain ENS — CCIP-Read async (`05-ens-namestone/findings.md`).

---

### P3 — Interface Freeze (1h, NEW per codex review)

Files: `packages/shared/src/types.ts`, `packages/shared/src/abi/ArgusVault.json`, `packages/shared/src/eip712.ts`, `packages/shared/src/env.ts` (zod schema).

Exported:

```ts
interface SwarmMessage {
  requestId: string;        // UUIDv4
  kind: "propose" | "reply" | "execute" | "receipt";
  chatId?: string;
  storageRoot?: string;     // 0G Storage content root
  outputHash?: string;      // keccak256 of canonical 0G output bytes
  decision?: "accept" | "reject";
  swapTxHash?: string;
  timestamp: number;
}

interface SignalPayload {  // serialized canonical form persisted to 0G Storage
  action: "rebalance" | "hold";
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;         // uint256 decimal
  reason: string;           // <=200 chars
  chatId: string;
  inputSnapshot: { vaultState: string; timestampWindow: [number, number] };
}

const EIP712_DOMAIN = {
  name: "ArgusVault", version: "1",
  chainId: 1301, verifyingContract: VAULT_ADDRESS,
} as const;
```

Acceptance: signal/execution/shim all import from `@argus/shared` and `tsc` passes.

Why this phase exists: codex flagged ABI/event-schema drift between contracts ↔ TS as HIGH risk. Freeze before parallel P4/P6 start.

---

### P4 — Signal Node (6h)

Files: `signal/src/{index,infer,storage,axl,config}.ts`, `signal/node-a-config.json`, `signal/node-a.pem`.

`infer.ts`: 0G Compute via `@0glabs/0g-serving-broker`. Capture `completion.id` as `chatId`, persist **raw `completion.choices[0].message.content` bytes verbatim** (do NOT JSON-reparse before hashing). Compute `outputHash = keccak256(rawBytes)`. Call `processResponse(provider, chatId, rawString)` — must be `true` before send.

`storage.ts`: upload `{rawBytes, signalPayload, chatId, inputSnapshot}` envelope to 0G Storage → return `storageRoot`.

System prompt (≤300 tokens):

```
You are a DeFi keeper. Given vault state, decide rebalance.
Reply JSON only: {"action":"rebalance"|"hold","tokenIn":"<addr>","tokenOut":"<addr>","amountIn":"<uint256>","reason":"<=150 chars"}
Uncertain → hold. Never hallucinate addresses.
```

Acceptance: log shows `chatId`, `isVerified:true`, `storageRoot`, `outputHash`.

Gotchas:
- `getRequestHeaders()` single-use — call right before each inference.
- One-shot `scripts/setup-0g.ts` for `addLedger(3)` + `acknowledgeProviderSigner` + `transferFund`.
- Wrong models: GLM-5 (agentic tool use), `qwen3.6-plus` (TeeTLS not TeeML) — see `01-0g-sdk/findings.md`.
- Persist canonical bytes per codex CRITICAL — content mismatch breaks `processResponse()` in P6.

---

### P5 — Execution Prereqs (1.5h, NEW per codex review)

Files: `scripts/fund-vault.ts`, `scripts/quote-dryrun.ts`.

Steps: fund vault with test WETH + USDC on Unichain Sepolia, set Universal Router approvals, run `cast call` quote against pool to confirm route + slippage.

Acceptance: `quote-dryrun.ts` prints `amountOut` > 0 for chosen pair.

Gotchas: Unichain Sepolia faucet 12h cooldown. V3 path: `abi.encodePacked(tokenIn, fee_3000, tokenOut)`. Set `slippageBps=50` (0.5%) and `deadline=now+5min`.

---

### P6 — Execution Node (6h)

Files: `execution/src/{index,verify,swap,sign,axl,config}.ts`, `execution/node-b-config.json`, `execution/node-b.pem` (**different keypair from node-a**).

`verify.ts` flow:
1. Receive `SwarmMessage` with `storageRoot` + `outputHash`.
2. Fetch envelope bytes from 0G Storage.
3. Assert `keccak256(rawBytes) == outputHash` (integrity).
4. Call `processResponse(provider, chatId, rawString)` against **exact** stored bytes — must be `true`.
5. Parse `signalPayload` from envelope (only AFTER hash check).
6. EIP-712 sign `VaultSwapTag`; call `Vault.executeRebalance`.

Acceptance: swap tx on `https://sepolia.uniscan.xyz`. `RebalanceExecuted` event emitted with correct `chatIdHash` + `outputHash`.

Gotchas:
- node-b.pem distinct from node-a.pem — same key = same Yggdrasil pubkey/IPv6 = broken routing (`04-axl-multinode/`).
- `tcp_port:7000` both configs.
- Verify against raw bytes, not re-serialized JSON (codex CRITICAL).

---

### P7 — AXL Wiring (3h)

Files: `scripts/start-nodes.sh`, `scripts/test-round-trip.sh`, `scripts/measure-latency.ts`.

Configs (from `04-axl-multinode/spike/`):

```json
// node-a-config.json
{ "private_key_path": "node-a.pem",
  "listen": ["tls://127.0.0.1:9101"],
  "api_addr": "127.0.0.1:9002", "tcp_port": 7000 }
// node-b-config.json
{ "private_key_path": "node-b.pem",
  "peers": ["tls://127.0.0.1:9101"],
  "api_addr": "127.0.0.1:9003", "tcp_port": 7000 }
```

Acceptance: `test-round-trip.sh` exits 0; `measure-latency.ts` logs p50/p95 for **remote-host pair** (not just loopback) — codex HIGH.

Re-plan if remote-host p95 >5s: collapse both nodes to one host, narrate as "swarm logically separated".

---

### P8 — KeeperHub Shim (5h)

Files: `shim/src/{index,store,axl-client,types}.ts`.

Endpoints:
- `POST /trigger` → generate `requestId`, store `{status:"pending"}`, fire AXL `/send` to Node A, return `202 {requestId}` instantly.
- `GET /status/:requestId` → return cached `ShimRequest`.
- Background poller: `/recv` from Node A every 500ms, max 60s, on Node B reply update store to `done|rejected`.

Idempotency: second POST with same `requestId` returns cached result (codex MEDIUM — KH retries built-in).

Public reachability: ngrok for demo; Fly.io/Railway for stable URL.

Acceptance: `curl POST /trigger` → 202; polling `/status` eventually `{status:"done", swapTxHash}`.

---

### P9 — KeeperHub Workflow (3h)

Files: `workflow/workflow.json`, `scripts/register-workflow.sh`.

Nodes: `trigger` (Manual for demo, Cron `*/5 * * * *` for judging) → `call-shim` (POST `${SHIM_URL}/trigger`) → `poll-result` (GET `${SHIM_URL}/status/${requestId}`, max 12 polls @ 5s).

Register: `kh wf create --nodes-file workflow.json` → `kh wf go-live <id>` → write `KH_WORKFLOW_ID` to `.env`.

Acceptance: `kh wf run <id> --wait` returns run summary with `swapTxHash`.

Gotchas: needs `kh auth login` (user). Fallback: `KH_API_KEY` REST mode if OAuth blocked.

---

### P10 — Uniswap FEEDBACK.md (1h, **MANDATORY, non-cuttable**)

File: `argus/FEEDBACK.md` + Uniswap form submission. >200 words. Cover: Universal Router `execute()` command encoding (V3 path underdocumented), Unichain Sepolia faucet reliability, missing typed SDK for Universal Router. Codex CRITICAL: write this **on May 1**, not May 6 — easy to forget under pressure.

---

### P11 — ENS Identity (2h impl + 24h human gate)

Files: `scripts/setup-ens.ts`.

`ns.setName({ name:"rebalancer", domain: NAMESTONE_PARENT_DOMAIN, address: agentEOA, text_records: { "agent.model":"deepseek-chat-v3-0324", "agent.keeper":"keeperhub", "agent.chain":"unichain-sepolia", "agent.vault":VAULT_ADDRESS, "agent.erc8004":"registered", "url":REPO_URL } })`.

Acceptance: `viem.getEnsAddress({ name: "rebalancer.<parent>.eth" })` returns agent EOA on Sepolia.

Gotchas:
- Sepolia Namestone resolver address — fetch from SDK constants, do NOT assume mainnet (`05-ens-namestone/findings.md`).
- ENS does NOT gate the contract — EIP-712 sig from EOA does. ENS is discovery/UX layer only.
- **Human gate**: Namestone form approval ~24h. If no approval by Apr 29, fall back to raw EOA + drop $750–$1.25K ENS prize.

---

### P12 — ERC-7857 iNFT (6h, **4h hard time-box**)

Files: `contracts/lib/0g-agent-nft/` (submodule), `scripts/{deploy-inft,mint-inft}.ts`.

Mint: encrypt `SignalPayload` with AES-GCM → upload ciphertext to 0G Storage → `agentNFT.mint(agentEOA, metadataHash, storageRoot, sealedKey)`.

Kill triggers (abort at 4h): can't deploy AgentNFT to Galileo after 1.5h, 0G Storage upload broken after 1h, SDK incompatible with current Galileo chain ID.

Fallback if dropped: 0G Storage already used as swarm bus in P4/P6 — still claims 0G Track B Swarms sub-bucket (3h savings).

---

### P13 — ERC-8004 Registry (2h)

Files: `scripts/register-erc8004.ts`.

Direct viem call to ERC-8004 Identity Registry — `@keeperhub/wallet` does NOT implement this (`07-keeperhub-deeper/findings.md`). Metadata URI hosts JSON: `{name, description, agentType:"keeper", x402:true, endpoints:{trigger:SHIM_URL+"/trigger"}, erc7857:INFT_TOKEN_URI}`.

Acceptance: registration tx confirmed; lookup returns metadata URI.

Gotcha: find Sepolia testnet deployment from EIP-8004 author repos (MetaMask/EF) — no canonical address yet.

---

### P14 — Demo Script (3h)

Files: `scripts/{pre-stage-inference,demo}.ts/sh`.

`pre-stage-inference.ts`: runs full 0G Compute call 30 min before demo, binds output to `inputSnapshot = { vaultState_hash, timestampWindow }` so cached signal is provably tied to live vault state at demo time. Saves to `demo-cache.json`.

`demo.sh`: prints chatId+isVerified from cache, triggers `kh wf run --wait`, polls shim status, prints final swap tx hash + Uniscan URL. Target: <90s wall clock.

Codex MEDIUM: emit `inputSnapshot.vaultState_hash` on-chain (could be added to `RebalanceExecuted` event) so judges can verify cached signal is bound to the actual vault state — closes the "pre-staging weakens trustless narrative" hole.

Fully pre-staged fallback: all outputs pre-computed, demo is narration over receipts (acceptable for blockchain demos).

---

### P15 — Demo UI (6h, optional)

Next.js page: chatId badge, `processResponse()` log, 0G Storage link, swap tx, ENS identity card. Cut first under polish category.

---

### P16 — Cloud Deploy (4h, AXL Option 2 — separate Fly apps)

Files: `argus/Dockerfile.shim` (done), `argus/Dockerfile.axl` (new), `argus/fly.shim.toml` (done), `argus/fly.axl-a.toml` + `argus/fly.axl-b.toml` (new), `argus/scripts/deploy-shim.sh` (done), `argus/scripts/deploy-axl.sh` (new).

**Topology** — 3 Fly apps in same region (e.g. `iad`):

```
KeeperHub workers (public internet)
  └─ https://argus-shim.fly.dev (public)            <- Express shim
       └─ argus-axl-a.internal:9002 (Fly 6PN)       <- AXL Node A (Signal)
            └─ argus-axl-b yggdrasil tls peer (6PN) <- AXL Node B (Execution)
                 └─ Unichain Sepolia (public)
```

**Why Option 2 over Option 1 (collapse) or Option 3 (laptop tunnel)**:

| | Option 1 Collapse | **Option 2 (chosen)** | Option 3 Yggdrasil tunnel |
|---|---|---|---|
| Gensyn p2p narrative | weak (single host) | **strong (real swarm)** | strong but fragile |
| Setup time | 10 min | 30 min | 60 min |
| Demo dependence on laptop | none | none | **laptop must stay online** |
| Inter-node latency | <5ms | 5-30ms (6PN same region) | 50-300ms |
| 90s budget risk | safest | safe | risky |

Option 1 collapses Gensyn submission to "single-node app importing AXL lib" → likely scored low or rejected. Option 2 keeps real send/recv between two machines with `iad↔iad` 6PN latency well under demo budget.

**Setup steps**:

1. `Dockerfile.axl` — base on `Dockerfile.shim`, replace `CMD` with AXL daemon entry (`axl serve --config /app/node-{a,b}-config.json`).
2. `fly.axl-a.toml` / `fly.axl-b.toml` — no `[http_service]` (private only); expose `9002` on internal IPv6 only; `[mounts]` not needed (stateless); embed Yggdrasil keypairs as Fly secrets.
3. `fly apps create argus-axl-a` + `argus-axl-b`; deploy each.
4. Cross-set Fly secrets so each peer knows the other's pubkey/IPv6:
   - `fly secrets set EXECUTION_PEER=<node-b-yggdrasil-ipv6> -a argus-axl-a`
   - `fly secrets set SIGNAL_PEER=<node-a-yggdrasil-ipv6> -a argus-axl-b`
   - `fly secrets set SIGNAL_PEER=<node-a-yggdrasil-ipv6> -a argus-shim`
   - `fly secrets set AXL_NODE_A_API=argus-axl-a.internal:9002 -a argus-shim`
5. Smoke: `fly ssh console -a argus-shim -C 'curl argus-axl-a.internal:9002/health'` → 200.
6. Re-register KH workflow with `SHIM_URL=https://argus-shim.fly.dev`.

**Acceptance**: `kh wf run --wait` from a separate machine (no laptop AXL) returns `swapTxHash` within 90s.

**Bail to Option 1 if**:
- Yggdrasil-over-6PN handshake doesn't connect within 1h.
- Inter-app round-trip p95 >100ms (would eat too much of 90s budget).
- Fly 6PN DNS resolution flaky during smoke.

Bail = merge AXL daemon back into `Dockerfile.shim` via tini/supervisord, set `AXL_NODE_A_API=127.0.0.1:9002`, redeploy single `argus-shim`. Lose Gensyn narrative but ship demo.

**Status (2026-04-29)**: shim half done — `Dockerfile.shim` + `fly.shim.toml` + `scripts/deploy-shim.sh` shipped (commit `088a149`). AXL apps + cross-peer secrets pending.

---

## Cross-Cutting Seams

### KeeperHub ↔ AXL async bridge
Shim returns 202 instantly; KeeperHub polls `/status` (12×5s = 60s budget). `requestId` UUIDv4 dedups at shim + `nonce` dedups at vault. Accept at-least-once; dedup at lowest layer.

### Verification chain (codex CRITICAL — strengthened)
Off-chain: `processResponse(provider, chatId, **exact raw bytes**)` → `true`. On-chain: `RebalanceExecuted(nonce, chatIdHash, outputHash, ...)` event. DA: `storageRoot` published to 0G Storage. Demo narrative shows: chatId badge → `processResponse()==true` log → 0G Storage link → on-chain event with matching hashes.

**Do NOT verify TEE signature on-chain** (impractical). The chatId+outputHash references + off-chain processResponse + 0G DA together carry the verifiability claim.

### RPC fallback
Every chain has `_BACKUP` RPC env. `config.ts` retries on backup, increments failCount, logs alert.

### AXL deploy topology (P16 — locked Option 2)
Three Fly apps (`argus-shim`, `argus-axl-a`, `argus-axl-b`) in same region. Public TLS only on `argus-shim`; AXL nodes private over Fly 6PN (`*.internal` IPv6/DNS). Yggdrasil pubkeys cross-injected as Fly secrets (`SIGNAL_PEER`, `EXECUTION_PEER`). Shim dials `argus-axl-a.internal:9002`. Bails to Option 1 (collapse into single image) per scope-cut ladder if 6PN peering or DNS flakes.

### EIP-712 domain (frozen in P3)
`{ name:"ArgusVault", version:"1", chainId:1301, verifyingContract:VAULT_ADDRESS }` + `SwapTag { bytes32 chatIdHash, bytes32 outputHash, uint256 nonce, bytes32 requestId, address tokenIn, address tokenOut, uint256 amountIn }`. Identical in Solidity (`_hashTypedDataV4`) and TypeScript (`viem.signTypedData`).

---

## Scope-Cut Ladder (in order)

| # | Cut | Hours saved | Prize impact | Trigger |
|---|-----|-------------|-------------|---------|
| 1 | P12 ERC-7857 iNFT | 6h | 0G Track B still claimed via Storage swarm bus | not started by EOD May 3 |
| 2 | P13 ERC-8004 | 2h | Stretch only — no direct prize | behind on May 3 |
| 3 | P15 Demo UI | 6h | Polish only | behind on May 4 |
| 4 | AXL >2 nodes | — | Keep exactly 2 | always |
| 5 | P11 ENS subname | 2h impl | Drops $750–$1.25K (ENS) | Namestone approval >48h late |
| 6 | P16 Option 2 → Option 1 (collapse AXL+shim into one Fly app) | 2h saved | Weakens Gensyn p2p narrative; still ships demo | Yggdrasil-over-6PN handshake fails 1h, OR inter-app p95 >100ms, OR Fly 6PN DNS flaky |

**Non-cuttable (codex MEDIUM lock):**
- P9 KeeperHub workflow run proof
- P10 Uniswap FEEDBACK.md
- P4/P6 0G `processResponse()` verification receipt
- P14 demo script

---

## Re-plan Triggers

| Trigger | Action |
|---------|--------|
| Apr 29 EOD: critical-path <50% | Apply cut #1+#2 immediately |
| May 1 EOD: no e2e dry-run | Switch to alt path "demo-minus-ENS/iNFT"; lock submission scope |
| May 4 EOD: not submission-ready | Drop P15 + final polish; freeze code, focus video+writeup |
| Namestone >48h pending | Drop ENS, raw EOA fallback |
| 0G Galileo RPC down >2h | Switch to `ZEROG_RPC_BACKUP`; if both down, mock `processResponse()` with stored fixture (note as known caveat) |
| AXL remote-host p95 >5s in P7 | Collapse to single host for demo |
| P16 Fly 6PN peering broken / inter-app p95 >100ms | Apply scope-cut #6 (Option 2 → Option 1 collapse) |
| `kh auth login` blocked | `KH_API_KEY` direct REST mode |
| Unichain swap consistently failing | Fall back to Sepolia (chain 11155111), PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Any phase >1.5× estimate | Triage: mock the broken component, file as known caveat |

---

## Sponsor Prize Checklist (verify before submit)

- [ ] KeeperHub: workflow runs in dashboard + x402 USDC paid
- [ ] KeeperHub: Builder Feedback Bounty submission (separate from Uniswap FEEDBACK.md)
- [ ] 0G Compute: `processResponse()==true` log + chatId in event
- [ ] 0G Track B: iNFT mint OR Storage swarm bus shown
- [ ] Uniswap: Universal Router swap on Unichain Sepolia explorer link
- [ ] Uniswap: FEEDBACK.md + form receipt
- [ ] Gensyn: 2 AXL nodes, send/recv logs, distinct keypairs
- [ ] ENS: subname resolves to agent EOA + text records (or documented fallback)

---

## Success Definition

`bash scripts/demo.sh` runs <90s, returns swap tx hash, all sponsor checklist boxes ticked, `tsc --noEmit` + `forge test` green, FEEDBACK.md submitted.
