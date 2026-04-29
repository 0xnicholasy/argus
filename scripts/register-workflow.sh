#!/usr/bin/env bash
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
FORCE_NEW=0
for arg in "$@"; do
  case "${arg}" in
    --create-only) CREATE_ONLY=1 ;;
    --force-new) FORCE_NEW=1 ;;
    -h|--help)
      cat <<USAGE
Usage: register-workflow.sh [--create-only] [--force-new]

  --create-only  Only create the draft workflow; skip go-live publish step.
  --force-new    Create a new workflow even if one with the same name exists.

Env:
  KH_BIN              Path to kh binary (default: ~/go/bin/kh)
  KH_WORKFLOW_NAME    Override the workflow name (default: from workflow.json)
USAGE
      exit 0
      ;;
    *)
      echo "Unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if ! "${KH_BIN}" auth status >/dev/null 2>&1; then
  echo "ERROR: 'kh auth status' failed. Run '${KH_BIN} auth login' first (browser OAuth)." >&2
  exit 1
fi

WF_NAME="${KH_WORKFLOW_NAME:-$(jq -r '.name' "${WORKFLOW_FILE}")}"
WF_DESC="$(jq -r '.description // ""' "${WORKFLOW_FILE}")"

# Idempotency: detect an existing workflow with the same name to avoid silent duplicates.
EXISTING_ID="$(
  "${KH_BIN}" wf list --json 2>/dev/null \
    | jq -r --arg n "${WF_NAME}" '[.[] | select(.name == $n)] | (.[0].id // empty)'
)"
if [ -n "${EXISTING_ID}" ] && [ "${FORCE_NEW}" -eq 0 ]; then
  echo "Found existing workflow '${WF_NAME}' (id: ${EXISTING_ID})." >&2
  echo "Skipping create. To force a new one, re-run with --force-new." >&2
  echo "To replace nodes/edges in place, use: ${KH_BIN} wf update ${EXISTING_ID} --nodes-file <file>" >&2
  WORKFLOW_ID="${EXISTING_ID}"
else
  echo "Creating workflow: ${WF_NAME}" >&2
  TMP_BUNDLE="$(mktemp)"
  trap 'rm -f "${TMP_BUNDLE}"' EXIT
  # --nodes-file expects an object with both `nodes` and `edges` keys (per `kh wf create --help`).
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
fi

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
