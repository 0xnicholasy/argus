import { useEffect, useMemo, useState } from "react";
import {
  FaArrowRight,
  FaBolt,
  FaBrain,
  FaCheckCircle,
  FaDatabase,
  FaExchangeAlt,
  FaShieldAlt,
  FaTimesCircle,
} from "react-icons/fa";
import { SPONSORS } from "../config";
import type { ShimEntry } from "../types";

type Tone = "info" | "ok" | "warn" | "fail";
interface Event {
  t: number; // ms relative to t0
  tone: Tone;
  icon: JSX.Element;
  label: string;
  detail?: string;
  evidence?: { k: string; v: string }[];
}

const short = (h: string, head = 10, tail = 6): string =>
  h.length > head + tail + 3 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;

const fmtT = (ms: number): string => {
  if (ms < 1000) return `t+0.0${Math.floor(ms / 100)}s`;
  return `t+${(ms / 1000).toFixed(1)}s`;
};

function buildEvents(entry: ShimEntry | null, nowTick: number): Event[] {
  if (!entry) return [];
  const t0 = entry.createdAt;
  const elapsed = Math.max(0, nowTick - t0);
  const events: Event[] = [];

  events.push({
    t: 0,
    tone: "info",
    icon: <FaBolt />,
    label: "shim.received",
    detail: `KeeperHub trigger · requestId ${short(entry.requestId)}`,
    evidence: [{ k: "workflow", v: SPONSORS.keeperhubWorkflow }],
  });
  events.push({
    t: 80,
    tone: "info",
    icon: <FaArrowRight />,
    label: "axl.dispatched",
    detail: `Yggdrasil → Node A (${short(SPONSORS.axlNodeA, 8, 4)})`,
  });

  if (entry.status === "pending") {
    events.push({
      t: elapsed,
      tone: "info",
      icon: <FaBrain />,
      label: "signal.computing",
      detail: `0G Compute TEEML · model ${SPONSORS.zerogModel}`,
    });
    return events;
  }

  if (entry.status === "rejected") {
    events.push({
      t: elapsed,
      tone: "fail",
      icon: <FaTimesCircle />,
      label: "pipeline.rejected",
      detail: entry.reason ?? "unknown",
    });
    return events;
  }

  // status === "done": burst the verified-step trail with the evidence we got.
  const tInfer = Math.max(800, Math.floor(elapsed * 0.45));
  const tStorage = Math.max(tInfer + 400, Math.floor(elapsed * 0.6));
  const tDispatchB = tStorage + 200;
  const tVerify = Math.max(tDispatchB + 300, Math.floor(elapsed * 0.85));
  const tSwap = elapsed;

  if (entry.chatId) {
    events.push({
      t: tInfer,
      tone: "ok",
      icon: <FaBrain />,
      label: "signal.inferred",
      detail: "0G TEEML inference complete · isVerified=true",
      evidence: [
        { k: "chatId", v: entry.chatId },
        ...(entry.outputHash ? [{ k: "outputHash", v: entry.outputHash }] : []),
      ],
    });
  }
  if (entry.storageRoot) {
    events.push({
      t: tStorage,
      tone: "ok",
      icon: <FaDatabase />,
      label: "storage.uploaded",
      detail: "Envelope persisted to 0G Storage",
      evidence: [{ k: "storageRoot", v: entry.storageRoot }],
    });
  }
  events.push({
    t: tDispatchB,
    tone: "info",
    icon: <FaArrowRight />,
    label: "axl.dispatched",
    detail: `Yggdrasil → Node B (${short(SPONSORS.axlNodeB, 8, 4)})`,
  });
  events.push({
    t: tVerify,
    tone: "ok",
    icon: <FaShieldAlt />,
    label: "execution.verified",
    detail: "Output hash matched · processResponse=true",
  });
  if (entry.swapTxHash) {
    events.push({
      t: tSwap,
      tone: "ok",
      icon: <FaExchangeAlt />,
      label: "uniswap.swapped",
      detail: "Universal Router swap on Unichain Sepolia",
      evidence: [{ k: "tx", v: entry.swapTxHash }],
    });
  }
  events.push({
    t: tSwap + 50,
    tone: "ok",
    icon: <FaCheckCircle />,
    label: "pipeline.done",
    detail: "Verifiable rebalance complete",
  });

  return events;
}

export function EventLog({ entry }: { entry: ShimEntry | null }) {
  // tick the elapsed counter while pending so the "computing" line breathes.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!entry || entry.status !== "pending") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [entry?.requestId, entry?.status]);

  const events = useMemo(() => buildEvents(entry, nowTick), [entry, nowTick]);

  return (
    <div className="card full">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Pipeline Events</h2>
        <span className="event-legend">
          shim → AXL → 0G Compute → 0G Storage → AXL → Vault → Uniswap
        </span>
      </div>
      {events.length === 0 ? (
        <div className="empty">Trigger the keeper to see the pipeline activity.</div>
      ) : (
        <ol className="event-log">
          {events.map((e, i) => (
            <li key={i} className={`event tone-${e.tone}`}>
              <span className="event-t mono">{fmtT(e.t)}</span>
              <span className="event-icon">
                {e.tone === "info" && entry?.status === "pending" && i === events.length - 1 ? (
                  <span className="spinner" />
                ) : (
                  e.icon
                )}
              </span>
              <span className="event-body">
                <span className="event-label mono">{e.label}</span>
                {e.detail && <span className="event-detail"> · {e.detail}</span>}
                {e.evidence && (
                  <span className="event-evidence">
                    {e.evidence.map((ev) => (
                      <span key={ev.k} className="event-chip mono">
                        <span className="event-chip-k">{ev.k}</span>
                        <span className="event-chip-v">{short(ev.v, 12, 6)}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
