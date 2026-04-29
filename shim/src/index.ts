// KeeperHub-facing HTTP shim.
// POST /trigger → mint requestId, fire `execute` SwarmMessage at signal peer via
// AXL /send, return 202 immediately. KeeperHub workflow polls GET /status/:id
// until status flips to "done" (with swapTxHash) or "rejected".
//
// A single background loop drains AXL /recv and routes receipts to the store
// keyed by requestId. A watchdog ages out pending requests past pollBudgetMs.

import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { hexlify } from "ethers";
import { loadEnv } from "@argus/shared";
import type { Env, Hex, SwarmMessage } from "@argus/shared";
import { createShimAxlClient, type ShimAxlClient } from "./axl-client.js";
import { ShimStore } from "./store.js";
import { triggerBodySchema, type ShimConfig } from "./types.js";

const REQUEST_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export function loadShimConfig(source: NodeJS.ProcessEnv = process.env): { cfg: ShimConfig; env: Env } {
  const env = loadEnv(source);
  // SIGNAL_PEER is checked at /trigger time, not boot — lets shim deploy
  // (and pass /health checks) before AXL Node A's Yggdrasil ID is known.
  const peer = source.SIGNAL_PEER ?? "";
  return {
    env,
    cfg: {
      port: Number(source.SHIM_PORT ?? "8787"),
      axlApiAddr: source.AXL_NODE_A_API ?? "127.0.0.1:9002",
      signalPeer: peer,
      pollIntervalMs: Number(source.SHIM_POLL_INTERVAL_MS ?? "500"),
      pollBudgetMs: Number(source.SHIM_POLL_BUDGET_MS ?? "60000"),
      requestTtlMs: Number(source.SHIM_REQUEST_TTL_MS ?? "300000"),
    },
  };
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}

function mintRequestId(): Hex {
  return hexlify(randomBytes(32)) as Hex;
}

export interface ShimAppDeps {
  store: ShimStore;
  axl: ShimAxlClient;
  cfg: ShimConfig;
}

export function createShimApp(deps: ShimAppDeps): express.Express {
  const { store, axl, cfg } = deps;
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", pending: store.size() });
  });

  app.post("/trigger", (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        if (!cfg.signalPeer) {
          res.status(503).json({ error: "signal_peer_unset", detail: "SIGNAL_PEER not configured (P7 AXL wiring pending)" });
          return;
        }
        const body = triggerBodySchema.parse(req.body ?? {});
        // Normalize hex casing so KH retries with mixed-case ids hit the same
        // store entry (codex MED).
        const requestId = ((body.requestId ?? mintRequestId()).toLowerCase()) as Hex;

        // Idempotency: KeeperHub retries POST with the same requestId must not
        // queue another swarm message (codex MED). Pending → return current
        // state; terminal → return cached.
        const existing = store.get(requestId);
        if (existing) {
          res.status(existing.status === "pending" ? 202 : 200).json(existing);
          return;
        }

        const message: SwarmMessage = {
          requestId,
          kind: "execute",
          timestamp: Math.floor(Date.now() / 1000),
        };

        try {
          await axl.send(cfg.signalPeer, message);
        } catch (err) {
          // Do NOT persist a rejected entry pre-send — that would poison future
          // retries with the cached failure (codex HIGH). Surface the error
          // synchronously and let KeeperHub decide whether to retry.
          logError("shim.send_failed", {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(502).json({ requestId, error: "axl_send_failed" });
          return;
        }

        const pending = store.putPending(requestId);
        logEvent("shim.triggered", { requestId, peer: cfg.signalPeer });
        res.status(202).json(pending);
      } catch (err) {
        next(err);
      }
    })();
  });

  app.get("/status/:requestId", (req: Request, res: Response) => {
    const raw = req.params.requestId;
    if (!raw || !REQUEST_ID_RE.test(raw)) {
      res.status(400).json({ error: "requestId must be 0x-prefixed bytes32" });
      return;
    }
    const requestId = raw.toLowerCase();
    const entry = store.get(requestId);
    if (!entry) {
      res.status(404).json({ error: "unknown requestId" });
      return;
    }
    res.status(200).json(entry);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "invalid_body", issues: err.issues });
      return;
    }
    logError("shim.unhandled_error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

export function startReceiptLoop(deps: ShimAppDeps): { stop: () => void } {
  const { store, axl, cfg } = deps;
  let running = true;

  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const env = await axl.recv(cfg.pollIntervalMs);
        if (!env) continue;
        const msg = env.payload;
        if (msg.kind !== "receipt" && msg.kind !== "reply") continue;

        const cached = store.get(msg.requestId);
        if (!cached) {
          // Receipt for a request we don't know about (restart, stranger) — skip.
          continue;
        }
        if (cached.status !== "pending") continue;

        if (msg.kind === "receipt") {
          if (msg.swapTxHash && msg.chatId && msg.outputHash && msg.storageRoot) {
            store.markDone(msg.requestId, {
              swapTxHash: msg.swapTxHash,
              chatId: msg.chatId,
              outputHash: msg.outputHash,
              storageRoot: msg.storageRoot,
            });
            logEvent("shim.completed", {
              requestId: msg.requestId,
              swapTxHash: msg.swapTxHash,
              chatId: msg.chatId,
            });
          } else {
            // Codex HIGH: silently dropping malformed receipts wedged the
            // request until the watchdog timed it out. Reject loudly instead.
            store.markRejected(msg.requestId, "malformed_receipt");
            logError("shim.malformed_receipt", {
              requestId: msg.requestId,
              haveSwapTxHash: Boolean(msg.swapTxHash),
              haveChatId: Boolean(msg.chatId),
              haveOutputHash: Boolean(msg.outputHash),
              haveStorageRoot: Boolean(msg.storageRoot),
            });
          }
        } else {
          // kind === "reply"
          if (msg.decision === "reject") {
            store.markRejected(msg.requestId, "swarm_rejected");
            logEvent("shim.rejected", { requestId: msg.requestId, chatId: msg.chatId });
          } else {
            // Unknown reply shape (no decision or decision="accept" with no
            // receipt fields). Fail closed so the request does not hang.
            store.markRejected(msg.requestId, "unhandled_reply");
            logError("shim.unhandled_reply", {
              requestId: msg.requestId,
              decision: msg.decision,
            });
          }
        }
      } catch (e) {
        logError("shim.recv_failed", { error: e instanceof Error ? e.message : String(e) });
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  };

  void loop();
  return { stop: () => { running = false; } };
}

export function startWatchdog(deps: ShimAppDeps): { stop: () => void } {
  const { store, cfg } = deps;
  const interval = setInterval(() => {
    const now = Date.now();
    // Walk entries via store API: we age-out pending requests past poll budget
    // by reading-then-rejecting. Sweep handles TTL eviction separately.
    // Reach into entries through a dedicated method to keep store encapsulated.
    for (const id of store.pendingIds()) {
      const entry = store.get(id);
      if (!entry || entry.status !== "pending") continue;
      if (now - entry.createdAt > cfg.pollBudgetMs) {
        store.markRejected(id, "poll_budget_exceeded");
        logEvent("shim.timeout", { requestId: id });
      }
    }
    store.sweep(now);
  }, Math.max(cfg.pollIntervalMs, 1_000));

  return { stop: () => clearInterval(interval) };
}

async function main(): Promise<void> {
  const { cfg } = loadShimConfig();
  const store = new ShimStore(cfg.requestTtlMs);
  const axl = createShimAxlClient({ apiAddr: cfg.axlApiAddr });
  const deps: ShimAppDeps = { store, axl, cfg };

  const app = createShimApp(deps);
  const recv = startReceiptLoop(deps);
  const watchdog = startWatchdog(deps);

  const server = app.listen(cfg.port, () => {
    logEvent("shim.listening", {
      port: cfg.port,
      axlApiAddr: cfg.axlApiAddr,
      signalPeer: cfg.signalPeer,
      pollIntervalMs: cfg.pollIntervalMs,
      pollBudgetMs: cfg.pollBudgetMs,
    });
  });

  const shutdown = (signal: string): void => {
    logEvent("shim.shutdown", { signal });
    recv.stop();
    watchdog.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logError("shim.fatal", { error: msg });
    process.exit(1);
  });
}
