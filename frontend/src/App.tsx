import { useEffect, useRef, useState } from "react";
import { getHealth, getStatus, trigger } from "./api";
import { Pipeline } from "./components/Pipeline";
import { StatusCard } from "./components/StatusCard";
import { VaultCard } from "./components/VaultCard";
import { ResultCard } from "./components/ResultCard";
import type { ShimEntry } from "./types";

const POLL_INTERVAL = 1500;
const HEALTH_INTERVAL = 5000;

export function App() {
  const [entry, setEntry] = useState<ShimEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<"up" | "down" | "unknown">("unknown");
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const pollRef = useRef<number | null>(null);
  // Generation guard: in-flight getStatus() resolving after re-trigger must not
  // overwrite the new entry. Bumped on every trigger; poll callbacks bail if stale.
  const genRef = useRef(0);

  // health probe
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        await getHealth();
        if (!cancelled) setHealth("up");
      } catch {
        if (!cancelled) setHealth("down");
      }
    };
    void probe();
    const id = window.setInterval(probe, HEALTH_INTERVAL);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPoll = (requestId: string) => {
    stopPoll();
    const gen = ++genRef.current;
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await getStatus(requestId);
        if (genRef.current !== gen) return;
        setEntry(next);
        if (next.status !== "pending") {
          stopPoll();
          setVaultRefresh((n) => n + 1);
        }
      } catch (e) {
        if (genRef.current !== gen) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }, POLL_INTERVAL);
  };

  useEffect(() => () => stopPoll(), []);

  const onTrigger = async () => {
    setBusy(true);
    setError(null);
    stopPoll();
    genRef.current += 1;
    try {
      const created = await trigger();
      setEntry(created);
      if (created.status === "pending") startPoll(created.requestId);
      else setVaultRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <img className="logo" src="/icon.png" alt="Argus" />
        <div>
          <div className="title">Argus</div>
          <div className="tagline">Verifiable AI DeFi Keeper · ETHGlobal Open Agents 2026</div>
        </div>
        <div className="spacer" />
        <span className={`badge ${health === "up" ? "live" : health === "down" ? "offline" : ""}`}>
          {health === "up" ? "Shim Online" : health === "down" ? "Shim Offline" : "Connecting…"}
        </span>
      </header>

      <Pipeline entry={entry} />

      <div className="grid" style={{ marginTop: 20 }}>
        <StatusCard entry={entry} busy={busy} onTrigger={onTrigger} error={error} />
        <VaultCard refreshKey={vaultRefresh} />
        <div className="full">
          <ResultCard entry={entry} />
        </div>
      </div>

      <footer className="footer">
        <div>
          KeeperHub Shim → AXL Swarm → 0G Compute (TEEML) → 0G Storage → Uniswap on Unichain Sepolia
        </div>
        <div>localhost demo · single-host AXL mesh</div>
      </footer>
    </div>
  );
}
