"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface LoadingState {
  /** Number of in-flight fetch requests */
  fetchCount: number;
  /** Active route navigation */
  navigating: boolean;
  /** Optional status text shown in the loader */
  statusText: string | null;
  /** Per-key loading states (e.g. "campaigns", "prospects") */
  keys: Set<string>;
}

interface LoadingContextValue {
  state: LoadingState;
  startFetch: (id?: string) => void;
  endFetch: (id?: string) => void;
  setNavigating: (v: boolean) => void;
  setStatusText: (text: string | null) => void;
  startKey: (key: string) => void;
  endKey: (key: string) => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error("useLoading must be used within LoadingProvider");
  return ctx;
}

/** Lightweight hook: returns true while any fetch is in flight. */
export function useGlobalBusy() {
  const { state } = useLoading();
  return state.fetchCount > 0 || state.navigating;
}

let fetchIdCounter = 0;

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [fetchCount, setFetchCount] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const activeFetches = useRef(new Set<string>());

  const startFetch = useCallback((id?: string) => {
    const fid = id ?? `fetch-${++fetchIdCounter}`;
    activeFetches.current.add(fid);
    setFetchCount((c) => c + 1);
    return fid;
  }, []);

  const endFetch = useCallback((id?: string) => {
    if (id) activeFetches.current.delete(id);
    setFetchCount((c) => Math.max(0, c - 1));
  }, []);

  const startKey = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const endKey = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Intercept global fetch to track in-flight requests
  useEffect(() => {
    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const id = `fetch-${++fetchIdCounter}`;
      activeFetches.current.add(id);
      setFetchCount((c) => c + 1);
      try {
        const res = await origFetch(input, init);
        return res;
      } finally {
        activeFetches.current.delete(id);
        setFetchCount((c) => Math.max(0, c - 1));
      }
    } as typeof fetch;
    return () => { window.fetch = origFetch; };
  }, []);

  return (
    <LoadingContext.Provider value={{
      state: { fetchCount, navigating, statusText, keys },
      startFetch, endFetch, setNavigating, setStatusText, startKey, endKey,
    }}>
      {children}
    </LoadingContext.Provider>
  );
}
