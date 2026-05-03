import { FaExternalLinkAlt, FaCheckCircle } from "react-icons/fa";
import { EXPLORER } from "../config";
import type { ShimEntry } from "../types";

export function ResultCard({ entry }: { entry: ShimEntry | null }) {
  return (
    <div className="card">
      <h2>Swap Result</h2>
      {!entry || entry.status !== "done" || !entry.swapTxHash ? (
        <div className="empty">No swap yet — trigger the keeper to see the result.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <FaCheckCircle style={{ color: "var(--green)" }} />
            <strong>Swap executed on Unichain Sepolia</strong>
          </div>
          <div className="kv">
            <div className="k">Tx Hash</div>
            <div className="v mono">{entry.swapTxHash}</div>
            <div className="k">Explorer</div>
            <div className="v">
              <a
                href={`${EXPLORER}/tx/${entry.swapTxHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on Blockscout <FaExternalLinkAlt style={{ verticalAlign: -1, marginLeft: 4 }} />
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
