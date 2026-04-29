#!/usr/bin/env bash
# Deploy the Argus shim to Fly.io.
#
# Usage:
#   set -a; source .env; set +a       # export local secrets
#   bash scripts/deploy-shim.sh        # first-time launch + deploy
#   bash scripts/deploy-shim.sh redeploy   # subsequent deploys (skip launch)
#
# Required env vars (sourced by user before running — script never reads .env):
#   PRIVATE_KEY          single signer key (used by execution node, also accepted here)
#
# Optional:
#   SIGNAL_PEER          Yggdrasil pubkey or IPv6 of AXL Node A
#   FLY_APP              app name (default: argus-shim)
#   FLY_REGION           region (default: iad)
#   FLY_ORG              org slug for `fly launch`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

FLY_APP="${FLY_APP:-argus-shim}"
FLY_REGION="${FLY_REGION:-iad}"
MODE="${1:-launch}"

if ! command -v fly >/dev/null 2>&1; then
  echo "ERROR: flyctl not installed. brew install flyctl" >&2
  exit 1
fi

if ! fly auth whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run 'fly auth login'." >&2
  exit 1
fi

if [ -z "${SIGNAL_PEER:-}" ]; then
  echo "NOTE: SIGNAL_PEER unset — shim deploys; /trigger returns 503 until P7 produces a Yggdrasil ID." >&2
  echo "      Add it later with: fly secrets set SIGNAL_PEER=<yggdrasil-ipv6> -a ${FLY_APP}" >&2
fi

# loadEnv() in @argus/shared validates these on startup. Missing any one
# crashes the shim before /health responds → Fly health-check timeout.
: "${PRIVATE_KEY:?PRIVATE_KEY required (zod schema in packages/shared/src/env.ts)}"
: "${SEPOLIA_RPC:?SEPOLIA_RPC required}"
: "${BASE_SEPOLIA_RPC:?BASE_SEPOLIA_RPC required}"
: "${UNICHAIN_SEPOLIA_RPC:?UNICHAIN_SEPOLIA_RPC required}"
: "${ZEROG_RPC:?ZEROG_RPC required}"

build_secrets() {
  SECRETS=(
    "PRIVATE_KEY=${PRIVATE_KEY}"
    "SEPOLIA_RPC=${SEPOLIA_RPC}"
    "BASE_SEPOLIA_RPC=${BASE_SEPOLIA_RPC}"
    "UNICHAIN_SEPOLIA_RPC=${UNICHAIN_SEPOLIA_RPC}"
    "ZEROG_RPC=${ZEROG_RPC}"
  )
  [ -n "${SIGNAL_PEER:-}" ]                && SECRETS+=("SIGNAL_PEER=${SIGNAL_PEER}")
  [ -n "${KH_API_KEY:-}" ]                 && SECRETS+=("KH_API_KEY=${KH_API_KEY}")
  [ -n "${SEPOLIA_RPC_BACKUP:-}" ]         && SECRETS+=("SEPOLIA_RPC_BACKUP=${SEPOLIA_RPC_BACKUP}")
  [ -n "${BASE_SEPOLIA_RPC_BACKUP:-}" ]    && SECRETS+=("BASE_SEPOLIA_RPC_BACKUP=${BASE_SEPOLIA_RPC_BACKUP}")
  [ -n "${UNICHAIN_SEPOLIA_RPC_BACKUP:-}" ] && SECRETS+=("UNICHAIN_SEPOLIA_RPC_BACKUP=${UNICHAIN_SEPOLIA_RPC_BACKUP}")
  [ -n "${ZEROG_INDEXER_URL:-}" ]          && SECRETS+=("ZEROG_INDEXER_URL=${ZEROG_INDEXER_URL}")
  [ -n "${VAULT_ADDRESS:-}" ]              && SECRETS+=("VAULT_ADDRESS=${VAULT_ADDRESS}")
}

case "${MODE}" in
  launch)
    if fly apps list --json 2>/dev/null | grep -q "\"Name\":\"${FLY_APP}\""; then
      echo "App ${FLY_APP} already exists; skipping launch." >&2
    else
      LAUNCH_ARGS=(--name "${FLY_APP}" --region "${FLY_REGION}" --copy-config --no-deploy --yes)
      if [ -n "${FLY_ORG:-}" ]; then
        LAUNCH_ARGS+=(--org "${FLY_ORG}")
      fi
      fly launch --config fly.shim.toml --dockerfile Dockerfile.shim "${LAUNCH_ARGS[@]}"
    fi

    build_secrets
    fly secrets set --app "${FLY_APP}" --stage "${SECRETS[@]}"

    fly deploy --app "${FLY_APP}" --config fly.shim.toml --remote-only
    ;;
  redeploy)
    fly deploy --app "${FLY_APP}" --config fly.shim.toml --remote-only
    ;;
  secrets)
    build_secrets
    fly secrets set --app "${FLY_APP}" "${SECRETS[@]}"
    ;;
  status)
    fly status --app "${FLY_APP}"
    ;;
  logs)
    fly logs --app "${FLY_APP}"
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    echo "Modes: launch | redeploy | secrets | status | logs" >&2
    exit 1
    ;;
esac

# `fly launch` may rename the app if the requested name is taken; trust
# the value persisted to fly.shim.toml over our local FLY_APP guess.
ACTUAL_APP="$(grep -E "^app = " fly.shim.toml 2>/dev/null | head -1 | sed -E "s/app = '([^']+)'/\1/" || echo "${FLY_APP}")"
URL="https://${ACTUAL_APP}.fly.dev"
echo "" >&2
echo "Shim URL: ${URL}" >&2
echo "Set SHIM_URL=${URL} in .env, then re-register the KeeperHub workflow:" >&2
echo "  bash scripts/register-workflow.sh" >&2
