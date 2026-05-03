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
          <div className="k">Request ID</div>
          <div className="v mono">{entry.requestId}</div>
          {entry.chatId && (
            <>
              <div className="k">Chat ID</div>
              <div className="v mono">{entry.chatId}</div>
            </>
          )}
          {entry.outputHash && (
            <>
              <div className="k">Output Hash</div>
              <div className="v mono">{entry.outputHash}</div>
            </>
          )}
          {entry.storageRoot && (
            <>
              <div className="k">Storage Root</div>
              <div className="v mono">{entry.storageRoot}</div>
            </>
          )}
          {entry.reason && (
            <>
              <div className="k">Reason</div>
              <div className="v">{entry.reason}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
