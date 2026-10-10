/**
 * Ordered handling of the Android system Back action.
 *
 * Layers are consulted from the most recently pushed (an open sheet or dialog)
 * down to the base layer (the active tool, then top-level navigation). The
 * first layer that returns `true` consumes the event.
 */
export type BackLayer = () => boolean;

export class BackDispatcher {
  private readonly layers: BackLayer[] = [];

  /** Pushes a layer on top. The returned function removes it again. */
  push(layer: BackLayer): () => void {
    this.layers.push(layer);
    return () => {
      const index = this.layers.lastIndexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
    };
  }

  get depth(): number {
    return this.layers.length;
  }

  /** Returns `true` when some layer consumed the Back action. */
  dispatch(): boolean {
    for (let index = this.layers.length - 1; index >= 0; index--) {
      if (this.layers[index]()) return true;
    }
    return false;
  }
}
