// AXL Node A HTTP client. Sends SwarmMessage to local AXL daemon /send,
// polls /recv for replies. AXL daemon handles Yggdrasil-encrypted p2p transport.

import { parseSwarmMessage } from "@argus/shared";
import type { SwarmMessage } from "@argus/shared";

export interface AxlClient {
  send(peer: string, msg: SwarmMessage): Promise<void>;
  recv(timeoutMs?: number): Promise<SwarmMessage | null>;
}

export interface AxlClientOptions {
  apiAddr: string;
  fetchImpl?: typeof fetch;
}

export function createAxlClient({ apiAddr, fetchImpl = fetch }: AxlClientOptions): AxlClient {
  const base = `http://${apiAddr}`;

  return {
    // AXL protocol — see shim/src/axl-client.ts header for full notes.
    // POST /send: X-Destination-Peer-Id header + raw body.
    // GET  /recv: 204 empty | 200 with X-From-Peer-Id header + raw body.
    async send(peer, msg) {
      const res = await fetchImpl(`${base}/send`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "X-Destination-Peer-Id": peer,
        },
        body: JSON.stringify(msg),
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
        const text = await res.text();
        // Codex HIGH: never trust /recv structurally — validate via shared zod schema.
        return parseSwarmMessage(JSON.parse(text));
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return null;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
