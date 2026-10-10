/**
 * Bottom-navigation controller.
 *
 * Follows Android's top-level destination model: switching tabs never builds
 * an ever-growing history, Back from any secondary destination returns to the
 * start destination, and Back on the start destination leaves the app.
 * Re-selecting the active tab is reported separately so screens can scroll to
 * the top instead of being rebuilt, and rapid repeated taps are ignored.
 */
export type NavigationEvent =
  | { type: "navigate"; from: string; to: string }
  | { type: "reselect"; id: string };

export type BackResult = "handled" | "exit";

export interface NavigatorOptions {
  /** Ignore repeated activations of the same destination within this window. */
  debounceMs?: number;
  now?: () => number;
}

export class Navigator {
  private currentId: string;
  private readonly listeners = new Set<(event: NavigationEvent) => void>();
  private lastActivation = { id: "", at: Number.NEGATIVE_INFINITY };
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(
    private readonly destinations: readonly string[],
    readonly startId: string,
    options: NavigatorOptions = {},
  ) {
    if (!destinations.length) throw new Error("Navigation needs at least one destination.");
    if (new Set(destinations).size !== destinations.length)
      throw new Error("Navigation destinations must be unique.");
    if (!destinations.includes(startId))
      throw new Error(`Start destination "${startId}" is not registered.`);
    this.currentId = startId;
    this.debounceMs = options.debounceMs ?? 300;
    this.now = options.now ?? (() => Date.now());
  }

  get current(): string {
    return this.currentId;
  }

  has(id: string): boolean {
    return this.destinations.includes(id);
  }

  subscribe(listener: (event: NavigationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Activates a destination. Returns `true` only when the visible destination
   * actually changed. Unknown ids and debounced duplicates are ignored.
   */
  navigate(id: string): boolean {
    if (!this.has(id)) return false;
    const at = this.now();
    const duplicate =
      this.lastActivation.id === id && at - this.lastActivation.at < this.debounceMs;
    this.lastActivation = { id, at };
    if (duplicate) return false;
    if (id === this.currentId) {
      this.emit({ type: "reselect", id });
      return false;
    }
    const from = this.currentId;
    this.currentId = id;
    this.emit({ type: "navigate", from, to: id });
    return true;
  }

  /** Top-level Back: return to the start destination, otherwise exit. */
  back(): BackResult {
    if (this.currentId === this.startId) return "exit";
    const from = this.currentId;
    this.currentId = this.startId;
    this.lastActivation = { id: this.startId, at: this.now() };
    this.emit({ type: "navigate", from, to: this.startId });
    return "handled";
  }

  private emit(event: NavigationEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

/** Reads a destination id from a `#/tool` hash, falling back when unknown. */
export function destinationFromHash(
  hash: string,
  destinations: readonly string[],
  fallback: string,
): string {
  const id = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return destinations.includes(id) ? id : fallback;
}
