/**
 * App-wide events that tools may react to without knowing about each other.
 * `session:clear` asks every tool to drop in-memory session data (for
 * example recent lookups) and report how many items it removed.
 */
export interface AppEvents {
  "session:clear": void;
}

type Handler<T> = (payload: T) => number | void;

export class EventBus<Events extends object = AppEvents> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(name: K, handler: Handler<Events[K]>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(name, set);
    return () => set.delete(handler as Handler<never>);
  }

  /** Calls every handler and returns the sum of the numbers they report. */
  emit<K extends keyof Events>(name: K, payload: Events[K]): number {
    let total = 0;
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      const result = (handler as Handler<Events[K]>)(payload);
      if (typeof result === "number") total += result;
    }
    return total;
  }
}
