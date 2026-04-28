#!/usr/bin/env bash
# P9 — Register the Argus KeeperHub workflow.
#
# Reads workflow/workflow.json, calls `kh wf create` then `kh wf go-live`,
# and prints the resulting workflow ID. Idempotent re-runs always create a
# new draft — write the printed ID into .env as KH_WORKFLOW_ID before
# `kh wf run`.
#
# Prerequisites (verified by scripts/check-gates.ts gate 3):
#   - kh CLI on PATH or at $KH_BIN (default ~/go/bin/kh)
#   - `kh auth login` completed (browser OAuth)
#   - SHIM_URL exported (publicly reachable URL of the shim) before
#     running `kh wf run` — workflow.json references it as ${SHIM_URL}.
#
# Usage:
#   bash scripts/register-workflow.sh                 # create + go-live
#   bash scripts/register-workflow.sh --create-only   # skip go-live
#   KH_WORKFLOW_NAME="Argus Demo" bash scripts/register-workflow.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKFLOW_FILE="${REPO_ROOT}/workflow/workflow.json"

KH_BIN="${KH_BIN:-${HOME}/go/bin/kh}"
if ! command -v "${KH_BIN}" >/dev/null 2>&1; then
  if command -v kh >/dev/null 2>&1; then
    KH_BIN="$(command -v kh)"
  else
    echo "ERROR: kh CLI not found. Install via 'go install github.com/keeperhub/cli/cmd/kh@latest' or set KH_BIN." >&2
    exit 1
  fi
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (parse workflow.json + kh JSON output)." >&2
  exit 1
fi

if [ ! -f "${WORKFLOW_FILE}" ]; then
  echo "ERROR: ${WORKFLOW_FILE} missing." >&2
  exit 1
fi

CREATE_ONLY=0
for arg in "$@"; do
  case "${arg}" in
    --create-only) CREATE_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if ! "${KH_BIN}" auth status >/dev/null 2>&1; then
  echo "ERROR: 'kh auth status' failed. Run 'kh auth login' first." >&2
  exit 1
fi

WF_NAME="${KH_WORKFLOW_NAME:-$(jq -r '.name' "${WORKFLOW_FILE}")}"
WF_DESC="$(jq -r '.description // ""' "${WORKFLOW_FILE}")"

echo "Creating workflow: ${WF_NAME}" >&2
TMP_BUNDLE="$(mktemp)"
trap 'rm -f "${TMP_BUNDLE}"' EXIT
jq '{nodes: .nodes, edges: .edges}' "${WORKFLOW_FILE}" >"${TMP_BUNDLE}"

CREATE_OUT="$(
  "${KH_BIN}" wf create \
    --name "${WF_NAME}" \
    --description "${WF_DESC}" \
    --nodes-file "${TMP_BUNDLE}" \
    --json \
    --yes
)"

WORKFLOW_ID="$(echo "${CREATE_OUT}" | jq -r '.id // .workflowId // .workflow.id // empty')"
if [ -z "${WORKFLOW_ID}" ]; then
  echo "ERROR: could not parse workflow id from kh response:" >&2
  echo "${CREATE_OUT}" >&2
  exit 1
fi

echo "Created workflow id: ${WORKFLOW_ID}" >&2

if [ "${CREATE_ONLY}" -eq 1 ]; then
  echo "${WORKFLOW_ID}"
  exit 0
fi

echo "Publishing (go-live)..." >&2
"${KH_BIN}" wf go-live "${WORKFLOW_ID}" --name "${WF_NAME}" --yes >&2 || {
  echo "WARN: go-live failed; the draft workflow ${WORKFLOW_ID} still exists." >&2
  echo "${WORKFLOW_ID}"
  exit 1
}

echo "Set KH_WORKFLOW_ID in .env to: ${WORKFLOW_ID}" >&2
echo "Test run: ${KH_BIN} wf run ${WORKFLOW_ID} --wait" >&2
echo "${WORKFLOW_ID}"
