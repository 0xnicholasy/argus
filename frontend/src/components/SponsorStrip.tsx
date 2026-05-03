import { FaExternalLinkAlt } from "react-icons/fa";
import { SPONSORS } from "../config";

const short = (h: string, head = 8, tail = 4): string =>
  h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;

export function SponsorStrip() {
  return (
    <div className="sponsors">
      <div className="sponsor">
        <div className="sponsor-name">KeeperHub</div>
        <div className="sponsor-detail mono">
          workflow {SPONSORS.keeperhubWorkflow} · paid via x402
        </div>
      </div>
      <div className="sponsor">
        <div className="sponsor-name">0G Compute + Storage</div>
        <div className="sponsor-detail mono">
          TEEML · {SPONSORS.zerogModel}
        </div>
      </div>
      <div className="sponsor">
        <div className="sponsor-name">Gensyn AXL</div>
        <div className="sponsor-detail mono">
          A {short(SPONSORS.axlNodeA)} · B {short(SPONSORS.axlNodeB)}
        </div>
      </div>
      <div className="sponsor">
        <div className="sponsor-name">Uniswap</div>
        <div className="sponsor-detail mono">
          Universal Router · Unichain Sepolia
        </div>
      </div>
      <div className="sponsor">
        <div className="sponsor-name">ENS · Namestone</div>
        <div className="sponsor-detail mono">
          <a href={SPONSORS.ensExplorer} target="_blank" rel="noreferrer">
            {SPONSORS.ensSubname} <FaExternalLinkAlt style={{ fontSize: 10 }} />
          </a>
        </div>
      </div>
    </div>
  );
}
