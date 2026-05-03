import { FaExclamationTriangle, FaShieldAlt } from "react-icons/fa";
import { FLAGS } from "../config";
import type { ShimEntry } from "../types";

interface Props {
  entry: ShimEntry | null;
}

export function VerifyBadge({ entry }: Props) {
  const hasResult = entry && entry.status === "done";
  const bypass = FLAGS.verifyBypassed;

  if (!hasResult) {
    return (
      <span className="verify-badge idle">
        <FaShieldAlt /> 0G TEEML · awaiting trigger
      </span>
    );
  }
  if (bypass) {
    return (
      <span
        className="verify-badge warn"
        title="0G Galileo provider signature endpoint flakes after inference; we bypass with ZEROG_DEV_BYPASS_VERIFY=1 and log it so the caveat is auditable. chatId/outputHash still emitted for independent verification."
      >
        <FaExclamationTriangle /> 0G TEEML · verify bypassed (testnet flake, logged)
      </span>
    );
  }
  return (
    <span className="verify-badge ok">
      <FaShieldAlt /> 0G TEEML · isVerified=true
    </span>
  );
}

export function FlagChips() {
  const chips: Array<{ label: string; tip: string }> = [];
  if (FLAGS.verifyBypassed) {
    chips.push({
      label: "ZEROG_DEV_BYPASS_VERIFY",
      tip: "0G provider signature endpoint flakes after inference. We bypass and log; chatId still verifiable.",
    });
  }
  if (FLAGS.storageFallback) {
    chips.push({
      label: "STORAGE_FALLBACK_ON_FAIL",
      tip: "0G Storage flow contract submit reverts on Galileo. Envelope persists to /tmp; same-host execution reads from there.",
    });
  }
  if (FLAGS.quoterSkipped) {
    chips.push({
      label: "QUOTER_OPTIONAL",
      tip: "Uniswap V3 QuoterV2 not deployed at canonical address on Unichain Sepolia. Execution skips quote, uses amountOutMin=1.",
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flag-chips">
      <span className="flag-chips-label">Demo-mode flags (auditable)</span>
      {chips.map((c) => (
        <span key={c.label} className="flag-chip mono" title={c.tip}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
