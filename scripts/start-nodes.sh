#!/usr/bin/env bash
# Start AXL Node A (signal) + Node B (execution) as background daemons.
# Logs to /tmp/argus-axl-{a,b}.log; pids to /tmp/argus-axl-{a,b}.pid.
#
# Env:
#   AXL_BIN  path to compiled AXL binary (default: $REPO_ROOT/04-axl-multinode/axl/node
#            then $REPO_ROOT/04-axl-multinode/spike/node, then `axl` on PATH)
#
# Usage:
#   bash scripts/start-nodes.sh           # start both
#   bash scripts/start-nodes.sh stop      # kill both
#   bash scripts/start-nodes.sh status    # show pid + port reachability
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGUS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ARGUS_ROOT}/.." && pwd)"

NODE_A_DIR="${ARGUS_ROOT}/signal"
NODE_B_DIR="${ARGUS_ROOT}/execution"
NODE_A_CONFIG="${NODE_A_DIR}/node-a-config.json"
NODE_B_CONFIG="${NODE_B_DIR}/node-b-config.json"
NODE_A_LOG="/tmp/argus-axl-a.log"
NODE_B_LOG="/tmp/argus-axl-b.log"
NODE_A_PID="/tmp/argus-axl-a.pid"
NODE_B_PID="/tmp/argus-axl-b.pid"
NODE_A_API="${NODE_A_API:-127.0.0.1:9002}"
NODE_B_API="${NODE_B_API:-127.0.0.1:9003}"

resolve_bin() {
  if [ -n "${AXL_BIN:-}" ] && [ -x "${AXL_BIN}" ]; then
    echo "${AXL_BIN}"
    return
  fi
  for cand in "${REPO_ROOT}/04-axl-multinode/axl/node" "${REPO_ROOT}/04-axl-multinode/spike/node"; do
    if [ -x "${cand}" ]; then
      echo "${cand}"
      return
    fi
  done
  if command -v axl >/dev/null 2>&1; then
    command -v axl
    return
  fi
  echo "ERROR: AXL binary not found. Set AXL_BIN or build via 04-axl-multinode/axl ('make build')." >&2
  exit 1
}

wait_api() {
  local addr="$1"
  local label="$2"
  local log="$3"
  local i
  for i in $(seq 1 50); do
    if curl -fsS "http://${addr}/topology" >/dev/null 2>&1; then
      echo "[${label}] API up at http://${addr} (after $((i * 200))ms)"
      return 0
    fi
    sleep 0.2
  done
  echo "ERROR: ${label} API at ${addr} did not become ready in 10s. Tail log: ${log}" >&2
  return 1
}

start_one() {
  local dir="$1" config="$2" log="$3" pid_file="$4" label="$5" api="$6" bin="$7"
  if [ -f "${pid_file}" ] && kill -0 "$(cat "${pid_file}")" 2>/dev/null; then
    if curl -fsS "http://${api}/topology" >/dev/null 2>&1; then
      echo "[${label}] already running (pid $(cat "${pid_file}"), API ready)"
      return
    fi
    echo "[${label}] stale pid $(cat "${pid_file}") (API unreachable); killing and restarting"
    kill "$(cat "${pid_file}")" 2>/dev/null || true
    sleep 0.3
    rm -f "${pid_file}"
  fi
  if [ ! -f "${config}" ]; then
    echo "ERROR: missing config ${config}" >&2
    exit 1
  fi
  echo "[${label}] starting (config=${config}, log=${log})"
  ( cd "${dir}" && nohup "${bin}" --config "${config}" >"${log}" 2>&1 & echo $! >"${pid_file}" )
  if ! wait_api "${api}" "${label}" "${log}"; then
    if [ -f "${pid_file}" ]; then
      kill "$(cat "${pid_file}")" 2>/dev/null || true
      rm -f "${pid_file}"
    fi
    return 1
  fi
}

stop_one() {
  local pid_file="$1" label="$2"
  if [ ! -f "${pid_file}" ]; then
    echo "[${label}] not running"
    return
  fi
  local pid
  pid="$(cat "${pid_file}")"
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" || true
    sleep 0.3
    if kill -0 "${pid}" 2>/dev/null; then kill -9 "${pid}" || true; fi
    echo "[${label}] stopped (pid ${pid})"
  else
    echo "[${label}] stale pid file"
  fi
  rm -f "${pid_file}"
}

status_one() {
  local pid_file="$1" api="$2" label="$3"
  if [ -f "${pid_file}" ] && kill -0 "$(cat "${pid_file}")" 2>/dev/null; then
    if curl -fsS "http://${api}/topology" >/dev/null 2>&1; then
      echo "[${label}] running pid=$(cat "${pid_file}") api=${api} reachable"
    else
      echo "[${label}] pid alive but API ${api} unreachable"
    fi
  else
    echo "[${label}] not running"
  fi
}

cmd="${1:-start}"
case "${cmd}" in
  start)
    BIN="$(resolve_bin)"
    echo "Using AXL binary: ${BIN}"
    start_one "${NODE_A_DIR}" "${NODE_A_CONFIG}" "${NODE_A_LOG}" "${NODE_A_PID}" "A" "${NODE_A_API}" "${BIN}"
    start_one "${NODE_B_DIR}" "${NODE_B_CONFIG}" "${NODE_B_LOG}" "${NODE_B_PID}" "B" "${NODE_B_API}" "${BIN}"
    echo "Both nodes up. Inspect peer IDs: curl http://${NODE_A_API}/topology | jq ."
    ;;
  stop)
    stop_one "${NODE_A_PID}" "A"
    stop_one "${NODE_B_PID}" "B"
    ;;
  status)
    status_one "${NODE_A_PID}" "${NODE_A_API}" "A"
    status_one "${NODE_B_PID}" "${NODE_B_API}" "B"
    ;;
  *)
    echo "Usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac
