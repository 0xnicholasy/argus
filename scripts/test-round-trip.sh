#!/usr/bin/env bash
# Round-trip test: A->B send/recv, then B->A. Exits 0 on success.
# Assumes nodes started via scripts/start-nodes.sh. Auto-starts if not running.
#
# Peer ID discovery:
#   1. NODE_A_PEER_ID / NODE_B_PEER_ID env if set
#   2. GET /topology on each node (parses self.peer_id)
#   3. error
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NODE_A_API="${NODE_A_API:-127.0.0.1:9002}"
NODE_B_API="${NODE_B_API:-127.0.0.1:9003}"

now_ns() { python3 -c 'import time; print(time.time_ns())'; }

# Auto-start if either node API is unreachable.
if ! curl -fsS "http://${NODE_A_API}/topology" >/dev/null 2>&1 || \
   ! curl -fsS "http://${NODE_B_API}/topology" >/dev/null 2>&1; then
  echo "Nodes not reachable; starting via scripts/start-nodes.sh"
  bash "${SCRIPT_DIR}/start-nodes.sh" start
fi

discover_peer() {
  local api="$1"
  local override="$2"
  if [ -n "${override}" ]; then
    echo "${override}"
    return
  fi
  local topo
  topo="$(curl -fsS "http://${api}/topology")"
  # Try common shapes: .self.peer_id, .self.public_key, .peer_id
  python3 - "${topo}" <<'PY'
import json, sys
t = json.loads(sys.argv[1])
paths = [
    ("our_public_key",), ("self","our_public_key"),
    ("self","peer_id"), ("self","public_key"), ("self","pubkey"),
    ("peer_id",), ("public_key",),
]
for path in paths:
    cur = t
    ok = True
    for k in path:
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            ok = False; break
    if ok and isinstance(cur, str) and cur:
        print(cur); sys.exit(0)
sys.exit("could not locate peer_id in /topology response: " + json.dumps(t)[:300])
PY
}

A_PUB="$(discover_peer "${NODE_A_API}" "${NODE_A_PEER_ID:-}")"
B_PUB="$(discover_peer "${NODE_B_API}" "${NODE_B_PEER_ID:-}")"
echo "A peer_id=${A_PUB}"
echo "B peer_id=${B_PUB}"

drain() {
  local api="$1"
  for _ in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w "%{http_code}" "http://${api}/recv")"
    [ "${code}" = "200" ] || break
  done
}

echo "Draining residual /recv buffers..."
drain "${NODE_A_API}"
drain "${NODE_B_API}"

send_and_wait() {
  local from_api="$1" to_pub="$2" to_api="$3" payload="$4"
  curl -fsS -X POST "http://${from_api}/send" \
    -H "X-Destination-Peer-Id: ${to_pub}" \
    --data-binary "${payload}" >/dev/null
  local deadline_s=$(( $(date +%s) + 10 ))
  while [ "$(date +%s)" -lt "${deadline_s}" ]; do
    body="$(mktemp)"
    code="$(curl -s -o "${body}" -w "%{http_code}" "http://${to_api}/recv")"
    if [ "${code}" = "200" ]; then
      got="$(cat "${body}")"
      rm -f "${body}"
      if [ "${got}" = "${payload}" ]; then
        echo "  recv match"
        return 0
      fi
      echo "  (skipping unrelated recv: '${got:0:40}')"
      continue
    fi
    rm -f "${body}"
    sleep 0.05
  done
  echo "  TIMEOUT waiting on ${to_api}/recv for payload" >&2
  return 1
}

PAYLOAD_AB="argus-rt-ab-$(now_ns)"
PAYLOAD_BA="argus-rt-ba-$(now_ns)"

echo "A -> B send..."
send_and_wait "${NODE_A_API}" "${B_PUB}" "${NODE_B_API}" "${PAYLOAD_AB}"
echo "B -> A send..."
send_and_wait "${NODE_B_API}" "${A_PUB}" "${NODE_A_API}" "${PAYLOAD_BA}"

echo "OK: round-trip A<->B verified"
