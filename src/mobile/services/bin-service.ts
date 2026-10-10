/**
 * BIN metadata service adapter.
 *
 * Wraps the existing Guison client (src/guison.ts) with mobile concerns:
 * an honest offline short-circuit, a single bounded retry for transient
 * failures, and a replaceable origin. It never fabricates metadata: every
 * successful result comes from the remote service, and every failure is
 * reported as such.
 */
import {
  checkApiStatus,
  lookupBin,
  LookupError,
  type BinMetadata,
  type LookupErrorCode,
} from "../../guison";
import type { NetworkMonitor } from "../platform/types";

export type BinErrorCode = LookupErrorCode | "offline";

export class BinServiceError extends Error {
  constructor(
    readonly code: BinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BinServiceError";
  }
  /** Whether trying again later could reasonably succeed. */
  get retryable(): boolean {
    return ["offline", "unavailable", "timeout", "rate_limit", "invalid_response"].includes(
      this.code,
    );
  }
}

export const OFFLINE_MESSAGE =
  "You're offline. BIN Lookup needs an internet connection to reach the metadata service. Generator and Card Sorter keep working offline.";

export interface BinMetadataService {
  readonly origin: string;
  readonly label: string;
  lookup(bin: string, signal?: AbortSignal): Promise<BinMetadata>;
  checkStatus(signal?: AbortSignal): Promise<void>;
}

export interface GuisonServiceOptions {
  origin: string;
  label: string;
  network: Pick<NetworkMonitor, "isOnline">;
  /** Extra attempts after a transient `unavailable` failure. */
  retries?: number;
  retryDelayMs?: number;
  lookupFn?: typeof lookupBin;
  statusFn?: typeof checkApiStatus;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LookupError("cancelled", "Lookup cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LookupError("cancelled", "Lookup cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toServiceError(error: unknown): BinServiceError {
  if (error instanceof BinServiceError) return error;
  if (error instanceof LookupError) return new BinServiceError(error.code, error.message);
  // Input validation errors from validateBin keep their user-facing message.
  if (error instanceof Error) return new BinServiceError("invalid_input", error.message);
  return new BinServiceError("unavailable", "The BIN metadata request failed unexpectedly.");
}

export function createGuisonService(options: GuisonServiceOptions): BinMetadataService {
  const retries = Math.max(0, options.retries ?? 1);
  const retryDelayMs = options.retryDelayMs ?? 1200;
  const lookupFn = options.lookupFn ?? lookupBin;
  const statusFn = options.statusFn ?? checkApiStatus;
  const sleep = options.sleep ?? abortableSleep;

  function ensureOnline() {
    if (!options.network.isOnline()) throw new BinServiceError("offline", OFFLINE_MESSAGE);
  }

  async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    ensureOnline();
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        const transient = error instanceof LookupError && error.code === "unavailable";
        if (!transient || attempt >= retries || signal?.aborted) throw toServiceError(error);
        try {
          await sleep(retryDelayMs * (attempt + 1), signal);
        } catch (sleepError) {
          throw toServiceError(sleepError);
        }
        if (!options.network.isOnline()) throw new BinServiceError("offline", OFFLINE_MESSAGE);
      }
    }
  }

  return {
    origin: options.origin,
    label: options.label,
    lookup: (bin, signal) => withRetry(() => lookupFn(bin, signal, options.origin), signal),
    checkStatus: (signal) => withRetry(() => statusFn(signal, options.origin), signal),
  };
}
