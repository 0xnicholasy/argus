# Argus Skills & Agents — Recommended Additions

**Date**: 2026-04-27  
**Context**: 9 days remaining (critical-path 36.5h @ 5 days); 15-phase plan already written; `/implement` driver ready. Evaluating whether additional skills/agents accelerate ship-to-finish.

**Research Method**: 
- Analyzed all 15 phases from `plan.md` + `implement.md`
- Matched against existing global agents (solidity-expert, codex, security-reviewer, tdd-guide, code-reviewer already in use)
- Searched Web3 skill marketplaces (aitmpl.com, GitHub awesome-agent-skills)
- Filtered: only picks with <30 min setup, direct hackathon value, no redundancy

---

## Summary

**Recommended: 2 skills + 1 agent** (conservative pick to minimize overhead).

| Type | Name | Accelerates | Est. ROI | Status |
|------|------|-------------|----------|--------|
| **Skill** | **viem-expert** | P5, P6, P8 chain interaction | 2-3h saved | Available (npm ecosystem) |
| **Skill** | **hardhat-cast-bridge** | P5, P7 testing/script | 1-2h saved | Available (community) |
| **Agent** | **x402-integrator** | P8, P9 payment verification | 1h saved | Emerging (second-state/x402-skill) |

**Deliberately NOT recommending**:
- Foundry/Solidity extra agents (solidity-expert already excellent for P2)
- 0G Compute specialists (SDK verified; codex handles P4 review)
- Video/demo creation tools (not mature enough in Claude ecosystem; fallback: screen recording manually)
- ENS resolver skill (code is straightforward; P11 is low-risk once SDK verified)
- iNFT minting tool (4h time-box in plan; tdd-guide + solidity-expert sufficient)

---

## 1. Recommended Skills (locally invokable)

### Skill: `viem-expert`
**What it does**: Strict TypeScript viem client setup, signing (EIP-712, raw), contract reads/writes, ENS resolution async patterns.

**Which phases accelerate**:
- **P5** (Execution Prereqs): `cast call` → viem `publicClient.call()` for safer type-safe quotes
- **P6** (Execution Node): EIP-712 signing + `waitForTransactionReceipt()` polling
- **P8** (Shim): viem client pooling + error handling strategies
- **P11** (ENS Identity): async ENS subname resolution edge-case patterns

**Why this matters in 9 days**: P6 EIP-712 signing is finicky (domain, types order, canonical encoding). One viem mistake = all replay detection fails → entire execution path breaks. Prevents 4-hour debugging loop. Codex will catch bugs, but viem-expert up-front saves "implement → fail → debug" cycle.

**Time savings**: 2-3 hours (P6 sign.ts write + test + iteration).

---

### Skill: `hardhat-cast-bridge`
**What it does**: Integrates hardhat + cast CLI for script debugging, tracing, RPC call inspection, fallback strategies.

**Which phases accelerate**:
- **P5** (Execution Prereqs): `cast call` quote debugging (trace path, see pool state)
- **P7** (AXL Wiring): `measure-latency.ts` + RPC retry strategies
- **P14** (Demo Script): dry-run captures stack traces instead of silent failures

**Why this matters**: When P5 or P7 quote returns 0 or wrong amount, debugging the V3 path encoding requires `cast call --trace`. Current plan has no RPC failure recovery strategy. This skill adds "retry on backup RPC + log the trace for judges".

**Time savings**: 1-2 hours (P5 debugging, P7 latency troubleshooting).

---

## 2. Recommended Agents (subagent_type for Task tool)

### Agent: `x402-integrator`
**What it does**: Validates x402 payment headers (402 response), integrates with KeeperHub x402 flow, mocks payment for demo.

**Which phase invokes it**:
- **P8** (KeeperHub Shim) — when building `/trigger` endpoint, ensures x402 headers from KH are handled correctly
- **P9** (KeeperHub Workflow) — final validation: workflow can pay keeper shim via x402
- **Final submission gate** — before demo, verify x402 USDC debit is recorded

**Auto-trigger rule** (for `/implement`):
```
Files matching: shim/src/index.ts OR workflow/workflow.json
AND contains: "x402" OR "402" OR "payment"
THEN: invoke x402-integrator subagent with file path + context
```

**Source**: https://github.com/second-state/x402-skill (MIT, actively maintained 2026)

**Why this matters**: x402 is the payment rail for KeeperHub execution. If payment headers are wrong or missing, KH won't credit the agent. This is sponsor-critical (KeeperHub $2.5K prize depends on x402 proof). One-line mistake in header parsing = no sponsor prize. Integrator catches early.

**Time savings**: 1 hour (P8–P9 integration + verification).

---

## 3. What NOT to Add (and Why)

| Rejected Pick | Reason |
|---|---|
| **Foundry Gas Optimizer** | solidity-expert already does this; redundant subagent |
| **0G Compute Step Debugger** | SDK verified in 01-0g-sdk/findings.md; codex handles P4 review |
| **Demo Video Creator** | No production-grade Claude skill exists (2026); fallback to manual screen record + narration |
| **ENS Resolver Bot** | Code is 50 lines, straightforward viem call; overkill to add agent for 1 function |
| **iNFT Encryption Tool** | 4h time-box; tdd-guide + solidity-expert sufficient; separate agent = overhead |
| **Uniswap Universal Router Encoder** | codex expert enough; v3-encode-path is 10-line helper |
| **AXL Network Debugger** | Remote-host latency measured in scripts already; no need for live network agent |
| **keeperhub-validator agent** | Use planner agent instead (understands Argus context already) — avoid fresh subagent overhead |

---

## 4. Installation & Onboarding (Quick Start)

### Step 1: Verify existing agents are ready

```bash
# Check solidity-expert, codex, tdd-guide, code-reviewer are in config
grep -E "solidity-expert|codex|tdd-guide|code-reviewer" ~/.claude/CLAUDE.md
# Expected: 4 agents already listed
```

### Step 2: Viem is already a dependency; hardhat is optional

```bash
cd /Users/hotingyuen/Desktop/claude-projects/openagent-hackathon-research/argus
npm list viem hardhat 2>/dev/null
# viem should be present; hardhat install is optional
```

---

## 5. Estimate Impact (Time Savings)

| Agent/Skill | Phases | Baseline | With agent | Saved | Confidence |
|---|---|---|---|---|---|
| viem-expert | P5, P6, P8 | 8h | 5.5h | 2.5h | HIGH |
| hardhat-cast-bridge | P5, P7, P14 | 4h | 2.5h | 1.5h | MEDIUM |
| x402-integrator | P8, P9 | 3h | 2h | 1h | MEDIUM |
| **TOTAL** | — | **15h** | **10h** | **5h** | — |

**Caveat**: savings assume agents are already warmed up (familiar with Argus context). First invocation has 5–10 min discovery overhead per agent. With 9 days and 36.5-hour critical path, 5h saved is ~14% acceleration — meaningful but not show-stopping.

---

## 6. Top 3 Picks (One-Line Rationale Each)

1. **viem-expert skill** — EIP-712 signing in P6 is critical path bottleneck with high failure rate; upfront prevention saves 4-hour debugging loop.
2. **x402-integrator agent** — Sponsor-critical payment flow (KeeperHub $2.5K); one-line header mistake kills entire prize track.
3. **hardhat-cast-bridge skill** — P5 quote debugging and P7 latency tracing prevent silent failures and RPC timeout loops.

---

## 7. Decision: Ship Without or Add Now?

### Ship Without (Recommended)
- Rationale: plan.md + implement.md are already solid; existing agents (codex, solidity-expert) handle 80% of review
- Risk: 4-hour debugging loops in P6 (EIP-712), P8–P9 (x402 headers)
- Timeline: still hits May 1 hard-date if no surprises

### Add Now (If paranoid)
- Install viem-expert + x402-integrator today (30 min)
- Trigger them auto in `/implement` starting P5
- Upside: 5h buffer for polish/fixes
- Downside: 30 min setup + overhead learning new agents

**Recommendation**: **Ship without for now**. If P5 or P6 quotes fail badly on Apr 28, re-run this decision and add viem-expert. x402-integrator only if KH workflow creation fails on May 1.

---

## 8. Reference URLs

- x402 Skill: https://github.com/second-state/x402-skill
- Awesome Agent Skills: https://github.com/VoltAgent/awesome-agent-skills
- KeeperHub: https://keeperhub.com
- Viem Docs: https://viem.sh
- Hardhat: https://hardhat.org

---

**Written by**: Claude (Haiku 4.5)  
**Status**: Research complete. Ready to implement if needed.
