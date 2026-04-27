// In-memory request store. Demo-scope only: process-restart loses state.
// TTL eviction prevents unbounded growth under sustained KeeperHub poll load.

import type { Hex, ShimRequest, ShimRequestDone, ShimRequestPending, ShimRequestRejected } from "@argus/shared";

export interface ShimRequestEntry {
  request: ShimRequest;
  expiresAt: number;
}

export class ShimStore {
  private readonly entries = new Map<string, ShimRequestEntry>();

  constructor(private readonly ttlMs: number) {}

  get(requestId: string): ShimRequest | undefined {
    const entry = this.entries.get(requestId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(requestId);
      return undefined;
    }
    return entry.request;
  }

  putPending(requestId: string): ShimRequestPending {
    const pending: ShimRequestPending = {
      status: "pending",
      requestId,
      createdAt: Date.now(),
    };
    this.entries.set(requestId, { request: pending, expiresAt: Date.now() + this.ttlMs });
    return pending;
  }

  markDone(
    requestId: string,
    fields: { swapTxHash: Hex; chatId: string; outputHash: Hex; storageRoot: string },
  ): ShimRequestDone | undefined {
    const existing = this.entries.get(requestId);
    if (!existing) return undefined;
    if (existing.request.status !== "pending") return undefined;
    const done: ShimRequestDone = {
      status: "done",
      requestId,
      createdAt: existing.request.createdAt,
      ...fields,
    };
    // Preserve original TTL: terminal entries should not extend lifetime past
    // the original window (codex MED — long-lived caches mask staleness).
    this.entries.set(requestId, { request: done, expiresAt: existing.expiresAt });
    return done;
  }

  markRejected(requestId: string, reason: string): ShimRequestRejected | undefined {
    const existing = this.entries.get(requestId);
    if (!existing) return undefined;
    if (existing.request.status !== "pending") return undefined;
    const rejected: ShimRequestRejected = {
      status: "rejected",
      requestId,
      createdAt: existing.request.createdAt,
      reason,
    };
    this.entries.set(requestId, { request: rejected, expiresAt: existing.expiresAt });
    return rejected;
  }

  delete(requestId: string): boolean {
    return this.entries.delete(requestId);
  }

  pendingIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.request.status === "pending") ids.push(id);
    }
    return ids;
  }

  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt < now) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.entries.size;
  }
}
