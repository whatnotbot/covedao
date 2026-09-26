"use client";

import { useSyncExternalStore } from "react";

/**
 * The indexer's height, polled once for the whole page.
 *
 * Everything Cove shows changes only when a block is indexed, so pages refetch
 * when this value changes (put it in an effect's dependencies) instead of
 * polling each endpoint on a timer. One shared poll serves every subscriber,
 * and it runs only while something is subscribed.
 */

export interface ChainStatus {
  network: string;
  appEnabled: boolean;
  core: { reachable: boolean; height: string; tip: string };
  indexer: { health: string; indexedHeight: string; stateRoot: string; lag: string; rebuilding: boolean };
  guardian: { configured: boolean };
  market: { enabled: boolean };
}

const POLL_MS = 5_000;

let status: ChainStatus | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function poll() {
  void fetch("/api/v3/status")
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) return;
      status = j.data as ChainStatus;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    poll();
    timer = setInterval(poll, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The latest /api/v3/status, or null before the first answer. */
export function useChainStatus(): ChainStatus | null {
  return useSyncExternalStore(subscribe, () => status, () => null);
}

/** The indexed block height ("" until known). Changes once per indexed block. */
export function useIndexedHeight(): string {
  return useChainStatus()?.indexer.indexedHeight ?? "";
}
