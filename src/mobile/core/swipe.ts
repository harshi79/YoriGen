/**
 * Horizontal swipe detection for the screen host.
 *
 * Deliberately narrow: it recognises a left or right swipe between top-level
 * destinations and nothing else. Vertical scrolling, text selection, buttons,
 * inputs and accessibility actions are never taken over.
 *
 * Two rules keep it predictable and cheap:
 *
 *  1. Axis lock. A gesture is only a candidate while horizontal travel leads
 *     vertical travel by a fixed ratio. The moment vertical wins, the gesture
 *     is released back to the page so a normal scroll is never blocked.
 *  2. Resolve on release. Nothing animates or navigates until the pointer is
 *     lifted past the threshold, so a half-dragged gesture cannot leave the UI
 *     in a moved-but-not-committed state, and no work happens per frame while
 *     the finger is down.
 *
 * The host carries `touch-action: pan-y`, so the browser keeps vertical panning
 * and hands horizontal travel to us without a `preventDefault` fight.
 */
export type SwipeDirection = "left" | "right";

export interface SwipeTrack {
  dx: number;
  dy: number;
  durationMs: number;
}

export interface SwipeRules {
  /** Minimum horizontal travel, in CSS px, before a swipe counts. */
  threshold?: number;
  /** Horizontal travel must lead vertical by this ratio to stay a candidate. */
  axisRatio?: number;
  /** A gesture slower than this is treated as a scroll or a drag, not a swipe. */
  maxDurationMs?: number;
}

export const DEFAULT_SWIPE_THRESHOLD = 56;
export const DEFAULT_SWIPE_AXIS_RATIO = 1.4;
export const DEFAULT_SWIPE_MAX_DURATION_MS = 1200;

/**
 * Pure decision for a completed gesture. Returns `null` when the gesture should
 * be handed back to the page (too short, too vertical, or too slow).
 */
export function resolveSwipe(
  track: SwipeTrack,
  rules: SwipeRules = {},
): SwipeDirection | null {
  const threshold = rules.threshold ?? DEFAULT_SWIPE_THRESHOLD;
  const axisRatio = rules.axisRatio ?? DEFAULT_SWIPE_AXIS_RATIO;
  const maxDurationMs = rules.maxDurationMs ?? DEFAULT_SWIPE_MAX_DURATION_MS;

  const dx = track.dx;
  const dy = track.dy;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * axisRatio) return null;
  if (track.durationMs > maxDurationMs) return null;
  return dx < 0 ? "left" : "right";
}

/** Elements whose own drag, selection or scroll behaviour must win. */
const INTERACTIVE =
  "input, textarea, select, button, a, label, summary, [contenteditable], [role='switch'], [data-no-swipe]";

export interface SwipeOptions extends SwipeRules {
  /** Called with the direction once a swipe is confirmed on release. */
  onSwipe(direction: SwipeDirection): void;
  /** Extra veto, consulted on pointerdown. The shell uses it for open dialogs. */
  isEnabled?(): boolean;
}

/**
 * Attaches the gesture to `target`. Returns a function that removes every
 * listener again.
 */
export function attachSwipe(target: HTMLElement, options: SwipeOptions): () => void {
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;

  const onPointerDown = (event: PointerEvent) => {
    // Primary button only; secondary and middle clicks are not gestures.
    if (!event.isPrimary || event.button !== 0) return;
    if (options.isEnabled && !options.isEnabled()) return;
    const origin = event.target as Element | null;
    // Let controls keep their own pointer behaviour.
    if (origin?.closest?.(INTERACTIVE)) return;
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = Date.now();
  };

  const finish = (event: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    const direction = resolveSwipe(
      {
        dx: event.clientX - startX,
        dy: event.clientY - startY,
        durationMs: Date.now() - startedAt,
      },
      options,
    );
    if (direction) options.onSwipe(direction);
  };

  const cancel = () => {
    tracking = false;
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", cancel);
  // A gesture that ends outside the host is abandoned, never resolved.
  target.addEventListener("pointerleave", cancel);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("pointerleave", cancel);
  };
}
