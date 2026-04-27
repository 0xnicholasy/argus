// AXL Node B HTTP client. Mirrors signal/src/axl.ts — only the api_addr differs.
// Both nodes talk to a local AXL daemon /send + /recv; daemon brokers Yggdrasil p2p.

import { parseSwarmMessage } from "@argus/shared";
import type { SwarmMessage } from "@argus/shared";

export interface AxlEnvelope {
  peer: string;
  payload: SwarmMessage;
}

export interface AxlClient {
  send(peer: string, msg: SwarmMessage): Promise<void>;
  recv(timeoutMs?: number): Promise<AxlEnvelope | null>;
}

export interface AxlClientOptions {
  apiAddr: string;
  fetchImpl?: typeof fetch;
}

export function createAxlClient({ apiAddr, fetchImpl = fetch }: AxlClientOptions): AxlClient {
  const base = `http://${apiAddr}`;

  return {
    async send(peer, msg) {
      const res = await fetchImpl(`${base}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peer, payload: msg }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AXL /send ${res.status}: ${text}`);
      }
    },
    async recv(timeoutMs = 5_000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${base}/recv`, { signal: ctrl.signal });
        if (res.status === 204) return null;
        if (!res.ok) throw new Error(`AXL /recv ${res.status}`);
        const body = (await res.json()) as { peer?: string; payload: unknown };
        if (!body.peer || typeof body.peer !== "string") {
          throw new Error("AXL /recv response missing peer field");
        }
        return { peer: body.peer, payload: parseSwarmMessage(body.payload) };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return null;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
