import { useEffect, useRef, useState } from "react";
import { FaArrowDown, FaArrowUp, FaSync, FaWallet } from "react-icons/fa";
import { fmtUsdc, fmtWeth, readVault } from "../api";
import { EXPLORER, VAULT_ADDRESS } from "../config";
import type { VaultBalances } from "../types";

interface Props {
  refreshKey: number;     // bumps after a done/rejected pipeline run
  snapshotKey: number;    // bumps when user triggers a new run
}

function diffStr(after: bigint, before: bigint, fmt: (v: bigint) => string): { text: string; sign: "up" | "down" | "zero" } {
  const d = after - before;
  if (d === 0n) return { text: `±${fmt(0n)}`, sign: "zero" };
  if (d > 0n) return { text: `+${fmt(d)}`, sign: "up" };
  // negative: format absolute value, prepend minus
  return { text: `−${fmt(-d)}`, sign: "down" };
}

export function VaultCard({ refreshKey, snapshotKey }: Props) {
  const [bal, setBal] = useState<VaultBalances | null>(null);
  const [before, setBefore] = useState<VaultBalances | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastSnapshotKey = useRef(snapshotKey);

  const load = async (): Promise<VaultBalances | null> => {
    setLoading(true);
    setErr(null);
    try {
      const next = await readVault();
      setBal(next);
      return next;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // initial + post-run reads
  useEffect(() => {
    void load();
  }, [refreshKey]);

  // capture snapshot at trigger time
  useEffect(() => {
    if (snapshotKey === lastSnapshotKey.current) return;
    lastSnapshotKey.current = snapshotKey;
    // snapshot from currently displayed balances; if not loaded yet, fetch fresh
    if (bal) {
      setBefore(bal);
    } else {
      void load().then((next) => {
        if (next) setBefore(next);
      });
    }
  }, [snapshotKey, bal]);

  const wethDiff = bal && before ? diffStr(bal.weth, before.weth, fmtWeth) : null;
  const usdcDiff = bal && before ? diffStr(bal.usdc, before.usdc, fmtUsdc) : null;
  const showDiff = Boolean(before && bal && (bal.weth !== before.weth || bal.usdc !== before.usdc));

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          <FaWallet style={{ verticalAlign: -2, marginRight: 6 }} /> Vault
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          <FaSync style={{ verticalAlign: -1, marginRight: 4 }} />
          {loading ? "loading" : "refresh"}
        </button>
      </div>

      {err && <div className="empty">read failed: {err}</div>}

      {bal && (
        <>
          <div className="balances">
            <div className="balance">
              <div className="label">WETH</div>
              <div className="value">
                {fmtWeth(bal.weth)}
                <span className="symbol">ETH</span>
              </div>
              {wethDiff && (
                <div className={`balance-diff ${wethDiff.sign}`}>
                  {wethDiff.sign === "up" ? <FaArrowUp /> : wethDiff.sign === "down" ? <FaArrowDown /> : null}
                  <span className="mono">{wethDiff.text}</span>
                </div>
              )}
            </div>
            <div className="balance">
              <div className="label">USDC</div>
              <div className="value">
                {fmtUsdc(bal.usdc)}
                <span className="symbol">USD</span>
              </div>
              {usdcDiff && (
                <div className={`balance-diff ${usdcDiff.sign}`}>
                  {usdcDiff.sign === "up" ? <FaArrowUp /> : usdcDiff.sign === "down" ? <FaArrowDown /> : null}
                  <span className="mono">{usdcDiff.text}</span>
                </div>
              )}
            </div>
          </div>
          {showDiff && (
            <div className="balance-banner">
              Rebalance applied · vault delta vs. pre-trigger snapshot
            </div>
          )}
          <div className="kv" style={{ marginTop: 14 }}>
            <div className="k">Address</div>
            <div className="v mono">
              <a href={`${EXPLORER}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">
                {VAULT_ADDRESS}
              </a>
            </div>
            <div className="k">Block</div>
            <div className="v mono">{bal.blockNumber}</div>
            {before && (
              <>
                <div className="k">Snapshot block</div>
                <div className="v mono">{before.blockNumber}</div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
