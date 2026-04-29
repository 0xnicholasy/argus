#!/usr/bin/env bash
# Runtime: write Fly secrets to disk, then exec axl-node.
#
# Required env (set as Fly secrets per app):
#   NODE_KEY_PEM       full PEM contents of the Yggdrasil private key
#   NODE_CONFIG_JSON   full JSON config (private_key_path must equal /app/node.pem)
#
# axl-node expects file paths, not inline blobs, so we materialize both
# at boot. This also keeps the same image usable for axl-a and axl-b.
set -euo pipefail

: "${NODE_KEY_PEM:?NODE_KEY_PEM secret required (base64)}"
: "${NODE_CONFIG_JSON:?NODE_CONFIG_JSON secret required (base64)}"

KEY_PATH=/app/node.pem
CFG_PATH=/app/config.json

# Both values are base64 so multi-line content survives `fly secrets import`
# without shell-quoting hazards.
umask 077
printf '%s' "${NODE_KEY_PEM}" | base64 -d > "${KEY_PATH}"
printf '%s' "${NODE_CONFIG_JSON}" | base64 -d > "${CFG_PATH}"

# Belt-and-braces: AXL refuses to start if the configured key path differs
# from the file we just wrote. Surface that mismatch loudly.
if ! grep -q "\"${KEY_PATH}\"" "${CFG_PATH}"; then
  echo "ERROR: NODE_CONFIG_JSON.PrivateKeyPath must equal ${KEY_PATH}" >&2
  exit 2
fi

exec /usr/local/bin/axl-node -config "${CFG_PATH}"
