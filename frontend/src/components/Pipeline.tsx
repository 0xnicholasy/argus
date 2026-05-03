import { Fragment } from "react";
import { FaBrain, FaDatabase, FaShieldAlt, FaExchangeAlt, FaCheck, FaTimes } from "react-icons/fa";
import { HiArrowRight } from "react-icons/hi";
import type { ShimEntry } from "../types";

type Stage = "idle" | "active" | "done" | "failed";

function stageOf(idx: number, entry: ShimEntry | null): Stage {
  if (!entry) return "idle";
  if (entry.status === "rejected") return idx === 0 ? "failed" : "idle";
  // pending → first 3 active in sequence (we don't have granular events, so all 3 light up)
  if (entry.status === "pending") {
    if (idx <= 2) return "active";
    return "idle";
  }
  // done
  return "done";
}

const STEPS: Array<{ icon: JSX.Element; title: string; sub: string }> = [
  { icon: <FaBrain />, title: "Signal", sub: "0G TEEML inference" },
  { icon: <FaDatabase />, title: "0G Storage", sub: "envelope + hash" },
  { icon: <FaShieldAlt />, title: "Execution", sub: "verify attestation" },
  { icon: <FaExchangeAlt />, title: "Uniswap", sub: "swap on Unichain" },
];

export function Pipeline({ entry }: { entry: ShimEntry | null }) {
  return (
    <div className="card full">
      <h2>Pipeline</h2>
      <div className="pipeline">
        {STEPS.map((s, i) => {
          const stage = stageOf(i, entry);
          return (
            <Fragment key={s.title}>
              <div className={`step ${stage}`}>
                <div className="icon">
                  {stage === "done" ? <FaCheck /> : stage === "failed" ? <FaTimes /> : s.icon}
                </div>
                <div className="step-title">{s.title}</div>
                <div className="step-sub">{s.sub}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="arrow">
                  <HiArrowRight />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
