import { FaPlay } from "react-icons/fa";
import type { ShimEntry } from "../types";

interface Props {
  entry: ShimEntry | null;
  busy: boolean;
  onTrigger: () => void;
  error: string | null;
}

export function StatusCard({ entry, busy, onTrigger, error }: Props) {
  const status = entry?.status ?? "idle";
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Trigger</h2>
        <span className={`status-pill ${status}`}>
          {status === "pending" && <span className="spinner" />}
          {status}
        </span>
      </div>

      <button className="btn" onClick={onTrigger} disabled={busy || status === "pending"}>
        <FaPlay style={{ verticalAlign: -1, marginRight: 8 }} />
        {status === "pending" ? "Running…" : "Trigger Keeper"}
      </button>

      {error && (
        <div className="empty" style={{ color: "var(--red)", marginTop: 12 }}>
          {error}
        </div>
      )}

      {entry && (
        <div className="kv" style={{ marginTop: 16 }}>
          <div className="k" title="Shim-minted bytes32 used end-to-end across the AXL swarm and emitted on-chain in RebalanceExecuted.">
            requestId
          </div>
          <div className="v mono">{entry.requestId}</div>
          {entry.chatId && (
            <>
              <div className="k" title="0G Compute TEE session id. Pair with outputHash to reproduce verification independently.">
                0G chatId
              </div>
              <div className="v mono">{entry.chatId}</div>
            </>
          )}
          {entry.outputHash && (
            <>
              <div className="k" title="SHA-256 of the raw model bytes. Same hash is emitted on-chain and matches the bytes stored in 0G Storage.">
                output hash
              </div>
              <div className="v mono">{entry.outputHash}</div>
            </>
          )}
          {entry.storageRoot && (
            <>
              <div className="k" title="0G Storage root. Anyone can fetch the envelope by this root, recompute the SHA-256, and confirm the AI output was not altered.">
                storage root
              </div>
              <div className="v mono">{entry.storageRoot}</div>
            </>
          )}
          {entry.reason && (
            <>
              <div className="k">reason</div>
              <div className="v">{entry.reason}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
