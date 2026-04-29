# Argus — Deployment Guide

Cloud deployment for the KeeperHub-facing shim. Provides a stable HTTPS URL
that KeeperHub workers can reach during async judging. Other components
(AXL nodes, signal, execution) run locally for now — see "AXL caveats" below.

Target: **Fly.io** (free hobby tier, persistent URL, no idle sleep).

---

## Prerequisites

- `flyctl` installed: `brew install flyctl`
- Fly account: `fly auth signup` (or `fly auth login`)
- Local repo green: `npm run typecheck` passes from `argus/`
- AXL Node A running and reachable from the deployment target for `/trigger`
  execution (see caveats). `SIGNAL_PEER` can be added after the first deploy.
- `.env` populated locally (we never commit it; secrets go to Fly via `fly secrets set`)

---

## One-time launch

```bash
cd argus

# 1. Export local secrets so the deploy script can forward them.
# SIGNAL_PEER may be empty for the first deploy.
set -a; source .env; set +a

# 2. Launch + deploy. Creates the app, registers fly.shim.toml, builds Dockerfile.shim.
bash scripts/deploy-shim.sh
```

Outputs `https://argus-shim.fly.dev` (or your `FLY_APP` override).
If `SIGNAL_PEER` is unset, the script prints a warning and deploys anyway.
`/health` works, but `/trigger` fails until the peer secret is added.

Set in `.env`:

```bash
SHIM_URL=https://argus-shim.fly.dev
```

Re-register the KeeperHub workflow so its nodes pick up the new URL:

```bash
bash scripts/register-workflow.sh
# copy the printed workflow id into KH_WORKFLOW_ID in .env
```

Smoke test:

```bash
curl -fsS https://argus-shim.fly.dev/health
# {"status":"ok","pending":0}
```

---

## Two-phase AXL wiring

Phase 1 gets a stable Fly URL for KeeperHub registration before AXL Node A is
wired:

```bash
set -a; source .env; set +a
bash scripts/deploy-shim.sh
```

Phase 2 runs after P7 AXL wiring produces the Yggdrasil IPv6/pubkey:

```bash
fly secrets set SIGNAL_PEER=<yggdrasil-ipv6> -a argus-shim
fly apps restart argus-shim
# or: bash scripts/deploy-shim.sh redeploy
```

Use `-a <your-fly-app>` if `FLY_APP` is not `argus-shim`.

---

## Subsequent deploys

```bash
set -a; source .env; set +a
bash scripts/deploy-shim.sh redeploy
```

Update secrets only (no rebuild):

```bash
set -a; source .env; set +a
bash scripts/deploy-shim.sh secrets
```

Tail logs:

```bash
bash scripts/deploy-shim.sh logs
```

---

## Fly secrets vs `[env]`

`fly.shim.toml` `[env]` block holds **non-sensitive** runtime config (port,
AXL API addr, poll budgets). Secrets go through `fly secrets set`:

| Var | Source | Notes |
|-----|--------|-------|
| `SIGNAL_PEER` | secret | Yggdrasil pubkey or IPv6 of AXL Node A |
| `PRIVATE_KEY` | secret | optional in shim; required if shim ever signs |
| `KH_API_KEY` | secret | optional REST fallback if `kh auth login` blocked |
| `SHIM_PORT` | env | 8787, fixed |
| `AXL_NODE_A_API` | env | `127.0.0.1:9002` only valid if Node A runs in same machine |

---

## AXL caveats — pick one

The shim talks to AXL Node A over HTTP at `AXL_NODE_A_API`. Cloud shim
**cannot dial your laptop's localhost**. Three options:

### Option 1 — collapse: shim + Node A in same Fly machine (fastest)

Bake the AXL daemon into `Dockerfile.shim`, run both via `tini` /
supervisord. Set `AXL_NODE_A_API=127.0.0.1:9002`. Matches the re-plan
fallback "collapse to single host" if AXL latency is a problem.

Trade-off: loses the "2 nodes geographically distributed" narrative for
Gensyn judging. Acceptable per `08-keeper-agent-design/KILL-CONDITIONS.md`.

### Option 2 — separate Fly app per AXL node (best narrative)

Spin `argus-axl-a` and `argus-axl-b` as their own Fly apps, peer them via
yggdrasil tls listen on Fly's 6PN private network. Shim points at
`argus-axl-a.internal:9002`. Two extra apps, two extra `fly.toml`s,
~20 min more setup.

### Option 3 — yggdrasil tunnel from laptop

Node A runs on laptop; cloud shim joins the same yggdrasil overlay so it
can route to Node A by IPv6. Requires shim image to embed yggdrasil
client. Complex; only worth it if you need true cross-region demo.

**Recommendation for hackathon**: Option 1 for the dry run, upgrade to
Option 2 only if Gensyn judging needs the distributed narrative.

---

## KeeperHub workflow templating — verify on first run

`workflow/workflow.json` uses `{{env.SHIM_URL}}` and
`{{call-shim.requestId}}`. Both are best-guess until the dashboard
accepts them. After `register-workflow.sh`:

```bash
kh wf get "${KH_WORKFLOW_ID}" --json | jq '.nodes[1].data.config'
# inspect normalized form. If KH rewrote / rejected the templating,
# adjust workflow.json and re-register.
```

Common fix-ups (try in order):

| Symptom | Fix |
|---------|-----|
| `${SHIM_URL}` literal in URL | already moved to `{{env.SHIM_URL}}` |
| `{{env.SHIM_URL}}` literal | try `{{vars.SHIM_URL}}` or hard-code the Fly URL into workflow.json |
| `{{call-shim.requestId}}` empty | try `{{nodes.call-shim.output.requestId}}` or `{{steps.call-shim.requestId}}` |
| `actionType: "Http"` rejected | try `HttpRequest`, `WebRequest`, `Webhook`, `RestCall` (browse the KH dashboard "New action" picker for the canonical name) |
| `HttpPoll` rejected | replace with shim long-poll (block `/trigger` up to 60s, return result inline) |

---

## Health checks

`fly.shim.toml` polls `/health` every 30s. The endpoint is implemented in
`shim/src/index.ts` and returns `{status:"ok", pending:<N>}`. Failures
trigger Fly to mark the machine unhealthy and restart it.

---

## State persistence — none

Shim holds `Map<requestId>` in memory. A redeploy or crash wipes pending
requests. Fine for demo. Do **not** scale beyond 1 machine
(`min_machines_running = 1` is also the max — KeeperHub retries land on
whichever machine handles them, and there is no shared store).

If state durability is needed later, add Redis via Fly's Upstash add-on
and replace `ShimStore` with a Redis-backed implementation.

---

## Tear-down

```bash
fly apps destroy argus-shim
```

Removes the app, secrets, and Fly-side state. Local files untouched.
