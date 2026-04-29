#!/usr/bin/env bash
# Deploy the two AXL nodes to Fly.io (P16, Option 2).
#
# Topology:
#   argus-axl-a.internal:9002   <- AXL Node A JSON API (signal)
#   tls://argus-axl-a.internal:9101  <- node A Yggdrasil listener
#   argus-axl-b.internal:9003   <- AXL Node B JSON API (execution)
#   tls://argus-axl-b.internal:9102  <- node B Yggdrasil listener
#
# Modes:
#   build       Cross-compile axl-node for linux/amd64 to argus/bin/axl-node
#   launch      First-time launch + secrets + deploy for both apps
#   redeploy    Redeploy both apps without re-launch
#   secrets     Re-stage NODE_KEY_PEM + NODE_CONFIG_JSON for both apps
#   status      Show fly status for both apps
#   logs <a|b>  Tail logs for the chosen app
#
# Required local files (reused from local AXL spike — distinct keypairs):
#   argus/signal/node-a.pem
#   argus/execution/node-b.pem
#
# After `launch`, set on argus-shim:
#   AXL_NODE_A_API=argus-axl-a.internal:9002
#   SIGNAL_PEER=<node-a yggdrasil ipv6>   (optional, P7-derived)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGUS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ARGUS_ROOT}/.." && pwd)"
cd "${ARGUS_ROOT}"

AXL_SRC_DIR="${AXL_SRC_DIR:-${REPO_ROOT}/04-axl-multinode/axl}"
AXL_BIN_OUT="${ARGUS_ROOT}/bin/axl-node"
APP_A="${APP_A:-argus-axl-a}"
APP_B="${APP_B:-argus-axl-b}"
FLY_REGION="${FLY_REGION:-iad}"
KEY_A="${ARGUS_ROOT}/signal/node-a.pem"
KEY_B="${ARGUS_ROOT}/execution/node-b.pem"

require() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not installed" >&2; exit 1; }; }

cmd_build() {
  require go
  if [ ! -d "${AXL_SRC_DIR}" ]; then
    echo "ERROR: AXL source not found at ${AXL_SRC_DIR} (set AXL_SRC_DIR)" >&2
    exit 1
  fi
  mkdir -p "${ARGUS_ROOT}/bin"
  echo "Building ${AXL_BIN_OUT} from ${AXL_SRC_DIR} (linux/amd64)..." >&2
  ( cd "${AXL_SRC_DIR}" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags='-s -w' -o "${AXL_BIN_OUT}" ./cmd/node )
  ls -lh "${AXL_BIN_OUT}"
}

# Yggdrasil pubkey/IPv6 derivation needs the axl-node tooling; we accept
# that the user already discovered them via P7 (test-round-trip.sh logs).
# If unset, set placeholders that AXL will reject loudly so wiring breaks
# fast rather than silently routing nowhere.
NODE_A_YGG_IPV6="${NODE_A_YGG_IPV6:-}"
NODE_B_YGG_IPV6="${NODE_B_YGG_IPV6:-}"

# NOTE: schema reflects what cmd/node/config.go actually reads.
# - PrivateKeyPath/Listen/Peers are Yggdrasil fields (case-insensitive JSON
#   match via Go encoding/json; PascalCase mirrors upstream node-config.json).
# - tcp_port/api_port/bridge_addr are ApiConfig fields (explicit lowercase JSON
#   tags). `api_addr` is NOT a real field — it would be silently ignored.
# - bridge_addr="" makes the API bind dual-stack (":9002"), which is required
#   so Fly 6PN can route argus-axl-{a,b}.internal:<port> to the process.
config_a() {
  cat <<'JSON'
{
  "PrivateKeyPath": "/app/node.pem",
  "Listen": ["tls://[::]:9101"],
  "Peers": [],
  "tcp_port": 7000,
  "api_port": 9002,
  "bridge_addr": ""
}
JSON
}

config_b() {
  cat <<'JSON'
{
  "PrivateKeyPath": "/app/node.pem",
  "Listen": ["tls://[::]:9102"],
  "Peers": ["tls://argus-axl-a.internal:9101"],
  "tcp_port": 7000,
  "api_port": 9003,
  "bridge_addr": ""
}
JSON
}

ensure_app() {
  local app="$1" cfg="$2"
  if fly apps list --json 2>/dev/null | grep -q "\"Name\":\"${app}\""; then
    echo "App ${app} exists; skipping launch." >&2
    return
  fi
  LAUNCH_ARGS=(--name "${app}" --region "${FLY_REGION}" --copy-config --no-deploy --yes)
  [ -n "${FLY_ORG:-}" ] && LAUNCH_ARGS+=(--org "${FLY_ORG}")
  fly launch --config "${cfg}" --dockerfile Dockerfile.axl "${LAUNCH_ARGS[@]}"
}

stage_secrets() {
  local app="$1" key_file="$2" config_payload="$3"
  if [ ! -f "${key_file}" ]; then
    echo "ERROR: missing keypair ${key_file}" >&2
    exit 1
  fi
  # Pipe via `fly secrets import` so neither the PEM nor the config JSON
  # ends up in shell history or `ps` output (codex MED hardening).
  printf 'NODE_KEY_PEM=%s\nNODE_CONFIG_JSON=%s\n' \
    "$(cat "${key_file}" | base64)" \
    "$(printf '%s' "${config_payload}" | base64)" \
    | fly secrets import --app "${app}" --stage
}

cmd_launch() {
  require fly
  fly auth whoami >/dev/null
  if [ ! -x "${AXL_BIN_OUT}" ]; then
    echo "axl-node binary missing — running 'build' first." >&2
    cmd_build
  fi
  ensure_app "${APP_A}" fly.axl-a.toml
  ensure_app "${APP_B}" fly.axl-b.toml
  stage_secrets "${APP_A}" "${KEY_A}" "$(config_a)"
  stage_secrets "${APP_B}" "${KEY_B}" "$(config_b)"
  fly deploy --app "${APP_A}" --config fly.axl-a.toml --remote-only
  fly deploy --app "${APP_B}" --config fly.axl-b.toml --remote-only
  print_followups
}

cmd_redeploy() {
  require fly
  fly deploy --app "${APP_A}" --config fly.axl-a.toml --remote-only
  fly deploy --app "${APP_B}" --config fly.axl-b.toml --remote-only
}

cmd_secrets() {
  require fly
  stage_secrets "${APP_A}" "${KEY_A}" "$(config_a)"
  stage_secrets "${APP_B}" "${KEY_B}" "$(config_b)"
  fly deploy --app "${APP_A}" --config fly.axl-a.toml --remote-only --strategy=immediate
  fly deploy --app "${APP_B}" --config fly.axl-b.toml --remote-only --strategy=immediate
}

cmd_status() {
  fly status --app "${APP_A}" || true
  fly status --app "${APP_B}" || true
}

cmd_logs() {
  case "${1:-}" in
    a) fly logs --app "${APP_A}" ;;
    b) fly logs --app "${APP_B}" ;;
    *) echo "Usage: deploy-axl.sh logs <a|b>" >&2; exit 2 ;;
  esac
}

print_followups() {
  cat >&2 <<EOF

AXL apps deployed.
  Node A API:  argus-axl-a.internal:9002
  Node B API:  argus-axl-b.internal:9003

Next:
  1. Smoke test from shim:
       fly ssh console -a argus-shim -C 'curl -sS argus-axl-a.internal:9002/topology | head'
  2. Point shim at Node A:
       fly secrets set AXL_NODE_A_API=argus-axl-a.internal:9002 -a argus-shim
  3. Once node A's Yggdrasil pubkey/IPv6 is observed in 'fly logs -a ${APP_A}':
       fly secrets set SIGNAL_PEER=<that-ipv6> -a argus-shim
EOF
}

case "${1:-launch}" in
  build)    cmd_build ;;
  launch)   cmd_launch ;;
  redeploy) cmd_redeploy ;;
  secrets)  cmd_secrets ;;
  status)   cmd_status ;;
  logs)     shift; cmd_logs "$@" ;;
  *) echo "Usage: $0 [build|launch|redeploy|secrets|status|logs <a|b>]" >&2; exit 2 ;;
esac
