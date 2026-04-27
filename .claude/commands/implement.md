---
description: Build driver for Argus — picks next phase from /plan, codes it, reviews with codex, verifies, fixes, ships. One-shot full cycle.
argument-hint: "[next | <phase-number> | \"<freeform-task>\"]"
---

# /implement — Argus Build Driver

Automated build cycle: discover phase → parallelism plan → code → codex review → verify → report.

## Command Behavior

| Arg | Effect |
|-----|--------|
| (none) or `next` | Read `.claude/commands/plan.md`, infer phase status from filesystem, implement lowest-numbered unblocked phase that is not DONE |
| `<n>` (1–15) | Override: implement phase n. Report incomplete blockers but proceed without confirmation prompt |
| `"<freeform>"` | Ad-hoc task description (multi-word in quotes). Skip phase mapping |

## Execution Flow

### 1. Discover Phase (automatic — DO NOT prompt user)

The plan lives at `.claude/commands/plan.md` (relative to repo root `argus/`). Read it directly with the Read tool. Do NOT ask the user to run `/plan` — the slash command body and the phase data are the same file.

```
Always: Read .claude/commands/plan.md (Phase Table + Per-Phase Drill-Down)

Never read .env. For env-dependent phases, inspect .env.example for required keys and the code/scripts that populate or consume them.

Status vocabulary (4 states):
  DONE                  — all REQUIRED_FILES exist AND DONE_CHECK passes (commands run + green)
  IN_PROGRESS           — some REQUIRED_FILES exist OR target dirs contain nontrivial phase code
  NOT_STARTED           — no REQUIRED_FILES, no target code
  BLOCKED_OR_EXTERNAL   — code artifacts complete but acceptance depends on off-repo state
                          (testnet deploy, explorer confirmation, kh OAuth, Namestone approval, form receipt)

Status detection matrix (REQUIRED_FILES + DONE_CHECK per phase):

  P1   FILES: package.json (root w/ workspaces), tsconfig.base.json, signal/{package.json,tsconfig.json},
              execution/{...}, shim/{...}, packages/shared/{...}, contracts/foundry.toml,
              workflow/workflow.json, ARCHITECTURE.md
       CHECK: `npx tsc --noEmit -p tsconfig.base.json` from root + `forge build` in contracts/
  P2   FILES: contracts/src/ArgusVault.sol, contracts/test/ArgusVault.t.sol,
              contracts/script/DeployArgusVault.s.sol; VAULT_ADDRESS key listed in .env.example
       CHECK: `forge test` green. BLOCKED_OR_EXTERNAL if not deployed (no broadcast receipt in contracts/broadcast/).
  P3   FILES: packages/shared/src/{types.ts,abi/ArgusVault.json,eip712.ts,env.ts}; @argus/shared
              imported by signal/, execution/, shim/
       CHECK: `npx tsc --noEmit` green in all 3 consumer workspaces
  P4   FILES: signal/src/{index,infer,storage,axl,config}.ts; signal/node-a-config.json; signal/node-a.pem
       CHECK: `npx tsc --noEmit -p signal/tsconfig.json` green
  P5   FILES: scripts/fund-vault.ts, scripts/quote-dryrun.ts
       CHECK: `npx tsc --noEmit` on scripts. BLOCKED_OR_EXTERNAL if dryrun not run against live RPC.
  P6   FILES: execution/src/{index,verify,swap,sign,axl,config}.ts; execution/node-b-config.json;
              execution/node-b.pem (distinct from node-a.pem)
       CHECK: `npx tsc --noEmit -p execution/tsconfig.json` green
  P7   FILES: scripts/start-nodes.sh, scripts/test-round-trip.sh, scripts/measure-latency.ts
       CHECK: `shellcheck` green on .sh files; manual run logged in docs/latency.md (BLOCKED_OR_EXTERNAL otherwise)
  P8   FILES: shim/src/{index,store,axl-client,types}.ts
       CHECK: `npx tsc --noEmit -p shim/tsconfig.json` green
  P9   FILES: workflow/workflow.json (filled in, not skeleton); scripts/register-workflow.sh;
              KH_WORKFLOW_ID key listed in .env.example
       CHECK: workflow.json has trigger+action+poll nodes. BLOCKED_OR_EXTERNAL until kh wf go-live run.
  P10  FILES: FEEDBACK.md (>200 words); docs/uniswap-feedback-receipt.{png,txt} OR explicit note in FEEDBACK.md
       CHECK: word count >200. BLOCKED_OR_EXTERNAL if no receipt artifact path.
  P11  FILES: scripts/setup-ens.ts
       CHECK: `npx tsc --noEmit` on script. BLOCKED_OR_EXTERNAL until Namestone approval logged.
  P12  FILES: contracts/lib/0g-agent-nft/ (submodule or copy); scripts/{deploy-inft,mint-inft}.ts
       CHECK: `forge build` green in contracts/. BLOCKED_OR_EXTERNAL until mint tx logged.
  P13  FILES: scripts/register-erc8004.ts
       CHECK: `npx tsc --noEmit` on script. BLOCKED_OR_EXTERNAL until registration tx logged.
  P14  FILES: scripts/pre-stage-inference.ts, scripts/demo.sh; demo-cache.schema.json or doc
       CHECK: `shellcheck scripts/demo.sh` green
  P15  FILES: ui/{package.json, app/page.tsx} (optional phase)
       CHECK: `npx tsc --noEmit` in ui/

Selection logic:
  if arg == 'next' or empty:
    Pick lowest-numbered phase whose status is NOT_STARTED or IN_PROGRESS,
    and whose "Blocks" col predecessors are all DONE or BLOCKED_OR_EXTERNAL.
    BLOCKED_OR_EXTERNAL phases are skipped for new "next" selection — surfaced in report instead.
  if arg matches /^\d+$/:
    Implement phase <n>. Report any incomplete blockers up front, then proceed without prompting.
  if arg contains spaces or starts with quote:
    Ad-hoc mode. Skip phase mapping entirely.

Default behavior: implement exactly ONE phase per invocation. Co-implement a sibling phase only on explicit user request.
```

If `plan.md` is missing, that is the only case where you should stop and tell the user to write a plan first. Otherwise proceed silently — no prompt, no "paste output below".

### 2. Parallelism Analysis

Pre-edit checks (always run before any implementation):
  `git branch --show-current` — if wrong branch, switch before editing
  `git status --short` — preserve unrelated dirty changes; never revert them
  Re-read the relevant phase block from plan.md (drift detection happens again before final report)

Identify which sub-tasks within the chosen phase are independent file-ownership slices.
If using subagents:
  Launch ALL independent subagents in a SINGLE assistant message so they start concurrently.
  Do not spawn one, wait, then spawn the next unless there is a hard dependency.
  Cap: 3-5 subagents max.
  Assign explicit file ownership and acceptance slice per subagent. Subagents must NOT
  edit overlapping files. Example format:
    Agent A owns signal/src/** except config.ts
    Agent B owns execution/src/**
    Agent C owns scripts/**

If the phase is tightly coupled (single flow, shared state), inline implement.

Record the parallelism plan in this response (and in a scratch task note if available)
— do not rely on session memory alone, sessions can reset mid-run.

### 3. Implement (file-by-file)

For each file or sub-task:

1. **Read context** (if file exists): existing code, build scripts, related types
2. **Write code** adhering to argus/CLAUDE.md:
   - TypeScript: no `any`/`unknown` without explicit justification noted in code-review report; no `// eslint-disable`; strict types; ES2022; bundler resolution
   - Solidity: gas optimization where natural; event emissions; nonce dedup; EIP-712 signature verification
   - Shell: POSIX-compatible; `set -euo pipefail`; error handling
   - **No emoji in source files** (Linux rendering)
   - **Never read .env** (use .env.example for schema only)
   - Commit grouping: keep changes conventional-commit-ready (feat/fix/chore/docs scoped per area)
3. **Dispatch specialist if heavy**:
   - Solidity contracts: trigger `solidity-expert` subagent (gas review + security)
   - TDD scenarios (test-first): mention `tdd-guide` subagent
   - Default: inline implementation

All parallel subagents should report: file, line count, acceptance-criterion coverage.

### 4. Codex Review (auto-retry on timeout)

After all code is written, invoke `codex` subagent with this exact bundle:

```
Codex input:
- `git diff --unified=3 -- <changed files>` output
- exact phase number + verbatim acceptance text copied from plan.md
- list of touched files
- direct imports (1-hop): shared types/contracts/env schema actually imported by changed files. Do not invent 2-hop expansion.
- verification commands run and their outcomes (tsc/forge/eslint exit codes)

Codex review ask: find behavioral bugs, schema drift between contracts<->TS, security issues, missing tests, and acceptance-criterion misses.
Output format strict: [CRITICAL|HIGH|MED|LOW] [file:line] [issue] [fix]
```

**Auto-fix rules**:
- CRITICAL + HIGH: fix immediately, run verify loop again
- MEDIUM + LOW: surface to user in report (optional fixes)

**Timeout fallback** (codex hangs):
- Retry once with extended timeout (30s)
- If still hangs: log degradation, proceed with claude-only review, note in report

### 5. Verify (autonomous, max 3 loops)

Run up to 3 verify-and-fix loops without user prompts. On each loop: auto-fix lint-only issues with `eslint --fix`. Stop early on success. Abort after 3 loops if non-lint failures remain.

Run commands directly — do NOT pipe through `head`/`tail`/`grep` (hides exit codes). Capture full exit code; truncate only when reporting.

**TypeScript workspaces**
```
npx tsc --noEmit -p <workspace>/tsconfig.json
npx eslint <workspace>/src --max-warnings 0
```
Install only if a manifest changed in this cycle and deps unresolved: `npm install --silent` from repo root.

**Solidity (only if contracts/ changed OR ABI updated)**
```
forge build
forge test
```

**Shell (only on modified .sh files, only if shellcheck installed)**
```
shellcheck -f gcc <changed .sh files>
```
Otherwise report `skipped: shellcheck not installed`.

**Auto-fix boundary** (precise):
- Allowed: `npx eslint <workspace>/src --fix` for formatting + clearly mechanical lint rules
- Forbidden: any fix that changes control flow, types, public interfaces, or test assertions — treat as code change and re-review before continuing

**Loop termination**:
- Pass: all relevant checks exit 0 → proceed to step 6
- Fail loop 1-2: apply lint auto-fixes, re-run; do NOT prompt user
- Fail loop 3: abort verify, mark phase PARTIAL, report exact failing commands + first 20 lines of output

### 6. Commit (opt-in only)

If verify passes:
- Stage source files only (never `.env`)
- Suggest conventional commit message:
  ```
  feat(phase-X-name): acceptance criterion in 1 line

  - sub-task a
  - sub-task b

  Codex review: 0 CRITICAL, 0 HIGH.
  ```
- Prompt: "Ready to commit? (y/n)" — never auto-commit
- Commit decline does NOT change implementation status. Code status (DONE/PARTIAL) and commit status are reported separately.

### 7. Report

```
=== /implement Phase <N> ===

Phase: <name>
Status: [DONE | PARTIAL | FAILED]
Files: <N> files touched
  - <file1> (+XX -YY lines)
  - <file2> (+AA -BB lines)

Parallelism: [3 agents] <agent1>, <agent2>, <agent3>
Timing: <mins> wall clock

Verify:
  TypeScript: ✓ (3 workspaces, all green)
  Solidity: ✓ (forge build + tests)
  Shell: — (none touched)

Codex review:
  CRITICAL: 0 (auto-fixed: 0)
  HIGH: 0 (auto-fixed: 0)
  MEDIUM: 0
  LOW: 0

Next phase (from /plan):
  Phase <N+1>: <name> (<hours>h, blocks: <blockers>)
  Usage: /implement next  OR  /implement <N+1>

Hints:
  - [if PARTIAL] Re-run `/implement <N>` to retry failures
  - [if all green] Commit ready. Run: git add <files> && git commit -m "..."
  - [if ENS/iNFT pending] Next critical-path phase: <n>. Alt path if slipping: /plan status
```

---

## Specialist Subagents

### Solidity: solidity-expert

Trigger for: any file in `contracts/src/*.sol` with non-trivial changes (>50 lines or new functions).

Input:
- File path
- Full diff (or new file content)
- Test file path (if exists)
- Acceptance criterion from phase

Output format:
- Security issues (vulnerabilities, access control, replay)
- Gas optimizations (storage packing, loops, external calls)
- Design feedback (event emissions, reversion messages, edge cases)

Auto-fix threshold: only CRITICAL issues are auto-fixed by `/implement`; MEDIUM/LOW passed to user.

### TypeScript: inline

No separate TS subagent by default — `/implement` writes TS code directly using Argus conventions. If TS changes are large (>200 LOC single file or complex generic types), note refactor risk in the final report.

### Tests: tdd-guide (auto, no mid-run prompt)

If phase involves >3 test functions or mock setup (e.g. P2 ArgusVault tests), invoke `tdd-guide` automatically as part of step 3. Do not prompt mid-run. Note any optional follow-up analyses in the final report only.

Input: test file + acceptance criterion. Output: coverage analysis, missing edge cases, fixture suggestions.

---

## Settings & Permissions

Refer to `.claude/settings.json` as source of truth. Do not duplicate the allowlist here.

---

## Implementation Notes for `/implement` Itself

This command is **not strictly idempotent** — re-running picks up wherever the filesystem state lands.

**Plan drift**: re-read the relevant phase block from plan.md before coding AND again before final report. If acceptance criteria or blockers changed mid-cycle, abort phase-completion claims and report drift.

**Output**: keep terse regardless of mode (tables, bullets, no prose padding).

**Hard-stop conditions** (only these abort): plan.md missing, required files unreadable, conflicting dirty edits in target files, missing required toolchain with no safe fallback. Everything else proceeds with degradation logged in report.

**Token budget**: for large phases (P4, P6 with 6h estimates), expect 20K+ input tokens for code review. Codex parallel invoke saves ~5min wall clock vs. sequential. Consider `/compact` hint if final report needed.

---

## Common Issues & Mitigations

| Issue | Mitigation |
|-------|-----------|
| Codex hangs | Retry once (30s timeout), then proceed claude-only; log degradation in report |
| `tsc --noEmit` timeout >60s | Retry once with longer timeout; do not block on timeout, proceed with codex review |
| Forge test fails mid-phase | Auto-skip tests if phase doesn't strictly require them (check blockers); note as known issue for later gate |
| Phase status ambiguous | Re-read the relevant plan.md phase block and inspect the specific REQUIRED_FILES. Never ask user to paste /plan output. |
| Parallel subagent diverges (writes conflicting code) | Coordination: explicit file-ownership slices per subagent + read shared types from `packages/shared/` first. Merge manually post-phase if conflicts arise. |
| Phase completion criteria unclear | Re-read REQUIRED_FILES + DONE_CHECK matrix in step 1. Do not prompt user. |
| Plan.md changed mid-cycle | Re-read relevant phase block before final report; if acceptance/blockers shifted, downgrade status to PARTIAL with drift note |
| Wrong git branch on entry | `git branch --show-current` first; switch to correct branch before any edits |

---

## Examples

### Example 1: `user: /implement next`

```
Discovering next phase...
[runs /plan next equivalent internally]

Phase 3: Interface Freeze (1h)
Files: packages/shared/src/{types,abi,eip712,env}.ts
Acceptance: tsc passes in all workspaces

Parallelism: Inline (4 related files, 1 flow)

Implementing...
  + packages/shared/src/types.ts (187 LOC, SwarmMessage + SignalPayload + VaultSwapTag)
  + packages/shared/src/abi/ArgusVault.json (auto-export from forge)
  + packages/shared/src/eip712.ts (EIP712_DOMAIN const + typedData builder)
  + packages/shared/src/env.ts (zod schema for 12 env vars)

Codex review... ✓ (0 issues)

Verify:
  tsc --noEmit
    signal/: ✓
    execution/: ✓
    shim/: ✓
    packages/shared/: ✓

=== Phase 3 Complete ===
Files: 4 touched (+320 -0 lines)
Next: Phase 4 (Signal Node, 6h, blocks: 5,6)
```

### Example 2: `user: /implement "fix P2 event naming"`

```
Ad-hoc task: fix P2 event naming

Freeform task detected. Proceeding without phase mapping.

Context: ArgusVault.t.sol + ArgusVault.sol
Changes: rename RebalanceExecuted event params for clarity

Parallelism: Inline

Implementing...
  contracts/src/ArgusVault.sol (event sig)
  contracts/test/ArgusVault.t.sol (event assertions)

Codex review... ✓ (0 issues)

Verify:
  forge build: ✓
  forge test: ✓ (4 tests pass)

=== Ad-hoc Task Complete ===
Files: 2 touched (+5 -3 lines)
Next: `/implement next` to continue main phases
```

---

## Exit Conditions

- **DONE**: verify loops pass, codex CRITICAL/HIGH resolved, report generated
- **PARTIAL**: verify fails after 3 loops OR codex CRITICAL unresolved -> report exact failures, suggest re-run
- **BLOCKED_OR_EXTERNAL**: code complete but acceptance depends on off-repo state (deploy, OAuth, approval) -> reported clearly, not an abort
- **ABORT** (rare): hard-stops only -- plan.md missing, required files unreadable, conflicting dirty edits, missing toolchain with no fallback

Commit declined != abort. Code status and commit status are independent.

---

## Optional Specialist Helpers (lazy-loaded)

See `.claude/SKILLS-AGENTS.md` (companion file written by claude-code-guide research) for vetted skill/agent picks. Defaults are NOT to invoke them -- only auto-trigger if a specific failure mode hits:

| Helper | Auto-trigger condition |
|--------|-----------------------|
| `viem-expert` skill | EIP-712 sig verification fails in P3/P6 codex review |
| `x402-integrator` agent | KH workflow registration fails or x402 payment header rejected in P9 |
| `hardhat-cast-bridge` skill | Quote dryrun fails in P5 OR remote-host AXL latency >5s in P7 |

Other helpers in SKILLS-AGENTS.md are research-only -- do not install proactively, hackathon time-budget too tight.
