import { useEffect, useState } from "react";
import { FaSync, FaWallet } from "react-icons/fa";
import { fmtUsdc, fmtWeth, readVault } from "../api";
import { EXPLORER, VAULT_ADDRESS } from "../config";
import type { VaultBalances } from "../types";

interface Props {
  refreshKey: number;
}

export function VaultCard({ refreshKey }: Props) {
  const [bal, setBal] = useState<VaultBalances | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setBal(await readVault());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [refreshKey]);

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
            </div>
            <div className="balance">
              <div className="label">USDC</div>
              <div className="value">
                {fmtUsdc(bal.usdc)}
                <span className="symbol">USD</span>
              </div>
            </div>
          </div>
          <div className="kv" style={{ marginTop: 14 }}>
            <div className="k">Address</div>
            <div className="v mono">
              <a href={`${EXPLORER}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">
                {VAULT_ADDRESS}
              </a>
            </div>
            <div className="k">Block</div>
            <div className="v mono">{bal.blockNumber}</div>
          </div>
        </>
      )}
    </div>
  );
}
