// Measure A->B AXL round-trip latency. Reports min/p50/p95/mean across N trials,
// appends a dated entry to docs/latency.md.
//
// Run: npm run measure-latency  (or: tsx scripts/measure-latency.ts [trials])
//
// Env:
//   NODE_A_API       default 127.0.0.1:9002
//   NODE_B_API       default 127.0.0.1:9003
//   NODE_A_PEER_ID   override (else fetched from /topology)
//   NODE_B_PEER_ID   override
//   LATENCY_TRIALS   default 10
//   LATENCY_LABEL    free-form note appended to docs/latency.md (e.g. "loopback", "remote-host")

import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_A_API = process.env.NODE_A_API ?? "127.0.0.1:9002";
const NODE_B_API = process.env.NODE_B_API ?? "127.0.0.1:9003";
const TRIALS = Number(process.env.LATENCY_TRIALS ?? process.argv[2] ?? 10);
const LABEL = process.env.LATENCY_LABEL ?? "loopback";

interface TopologySelf {
  our_public_key?: string;
  peer_id?: string;
  public_key?: string;
  pubkey?: string;
}

interface Topology {
  our_public_key?: string;
  self?: TopologySelf;
  peer_id?: string;
  public_key?: string;
}

async function discoverPeer(api: string, override: string | undefined): Promise<string> {
  if (override && override.length > 0) return override;
  const res = await fetch(`http://${api}/topology`);
  if (!res.ok) throw new Error(`topology ${api} -> ${res.status}`);
  const t = (await res.json()) as Topology;
  const candidate =
    t.our_public_key ??
    t.self?.our_public_key ??
    t.self?.peer_id ??
    t.self?.public_key ??
    t.self?.pubkey ??
    t.peer_id ??
    t.public_key;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`peer_id not found in /topology of ${api}: ${JSON.stringify(t).slice(0, 300)}`);
  }
  return candidate;
}

async function drain(api: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`http://${api}/recv`);
    if (r.status !== 200) return;
    await r.arrayBuffer();
  }
}

async function oneTrial(fromApi: string, toPub: string, toApi: string, payload: string): Promise<number> {
  const start = process.hrtime.bigint();
  const send = await fetch(`http://${fromApi}/send`, {
    method: "POST",
    headers: { "X-Destination-Peer-Id": toPub },
    body: payload,
  });
  if (!send.ok) throw new Error(`send -> ${send.status}`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const r = await fetch(`http://${toApi}/recv`);
    if (r.status === 200) {
      const end = process.hrtime.bigint();
      const body = await r.text();
      if (body === payload) return Number(end - start) / 1e6;
      // Skip stale/unrelated message; keep polling.
      continue;
    }
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("recv timeout");
}

function stats(samples: number[]): { min: number; p50: number; p95: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    const v = sorted[idx];
    if (typeof v !== "number") throw new Error("empty samples");
    return v;
  };
  const first = sorted[0];
  if (typeof first !== "number") throw new Error("empty samples");
  return {
    min: first,
    p50: pick(0.5),
    p95: pick(0.95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

async function main(): Promise<void> {
  if (!Number.isInteger(TRIALS) || TRIALS <= 0) {
    throw new Error(`LATENCY_TRIALS must be a positive integer, got ${TRIALS}`);
  }
  const aPub = await discoverPeer(NODE_A_API, process.env.NODE_A_PEER_ID);
  const bPub = await discoverPeer(NODE_B_API, process.env.NODE_B_PEER_ID);
  console.log(`A peer_id=${aPub}`);
  console.log(`B peer_id=${bPub}`);

  await drain(NODE_A_API);
  await drain(NODE_B_API);

  const samples: number[] = [];
  for (let i = 1; i <= TRIALS; i++) {
    const payload = `argus-lat-${i}-${Date.now()}`;
    const ms = await oneTrial(NODE_A_API, bPub, NODE_B_API, payload);
    console.log(`Trial ${i}: ${ms.toFixed(1)}ms`);
    samples.push(ms);
  }

  const s = stats(samples);
  const summary = `min=${s.min.toFixed(1)}ms p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms mean=${s.mean.toFixed(1)}ms`;
  console.log(`\n${summary}`);

  const here = dirname(fileURLToPath(import.meta.url));
  const docsPath = resolve(here, "..", "docs", "latency.md");
  await mkdir(dirname(docsPath), { recursive: true });
  const ts = new Date().toISOString();
  const entry =
    `## ${ts} (${LABEL}, ${TRIALS} trials)\n\n` +
    `${summary}\n\n` +
    `samples (ms): ${samples.map((v) => v.toFixed(1)).join(", ")}\n\n` +
    `nodes: A=${NODE_A_API} (${aPub.slice(0, 12)}...) B=${NODE_B_API} (${bPub.slice(0, 12)}...)\n\n---\n\n`;
  await appendFile(docsPath, entry, "utf8");
  console.log(`Appended to ${docsPath}`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`measure-latency failed: ${msg}`);
  process.exit(1);
});
