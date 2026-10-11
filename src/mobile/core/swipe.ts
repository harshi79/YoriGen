/**
 * Horizontal swipe gesture for the screen host.
 *
 * The gesture is deliberately narrow: it tracks a left or right drag between
 * top-level destinations and nothing else. Vertical scrolling, text selection,
 * buttons, inputs and accessibility actions are never taken over.
 *
 * Lifecycle:
 *
 *  1. Candidate. A pointer down on ordinary surface becomes a candidate. No
 *     callback fires yet, so a tap or a vertical scroll is unaffected.
 *  2. Axis lock. Once horizontal travel passes a small slop and leads vertical
 *     travel by a fixed ratio, the gesture locks and `onDragStart` fires. The
 *     pointer is captured so the drag keeps tracking outside the host. If
 *     vertical travel wins first, the gesture is released back to the page.
 *  3. Live drag. Every move reports the travel measured from the pointer-down
 *     point, so the content is offset by exactly as much as the finger has
 *     moved: at the lock it catches up with the slop it needed to resolve the
 *     axis, and from then on it tracks the finger one to one. Nothing in this
 *     handler reads layout, touches the DOM outside the two composited
 *     properties the caller writes, or allocates.
 *  4. Release. `onDragEnd` reports the total travel and the release velocity.
 *     The caller decides whether to commit with `shouldCommitSwipe`. The travel
 *     it reports is the same distance the content moved, so the commit
 *     threshold is measured against the finger, not against the slop.
 *
 * The host carries `touch-action: pan-y`, so the browser keeps vertical panning
 * and hands horizontal travel to us without a `preventDefault` fight.
 */
export type SwipeDirection = "left" | "right";

export interface SwipeRelease {
  /** Total horizontal travel from the pointer-down point, in CSS px. */
  dx: number;
  /** Velocity of the last ~100 ms of travel, in CSS px per millisecond. */
  velocity: number;
}

/** Horizontal travel that must be made before a drag locks as horizontal. */
export const SWIPE_LOCK_SLOP = 8;
/** Horizontal travel must lead vertical travel by this ratio to lock. */
export const DEFAULT_SWIPE_AXIS_RATIO = 1.4;
/** A flick needs at least this much travel, so tiny nudges never commit. */
export const DEFAULT_SWIPE_THRESHOLD = 56;
/** Share of the screen width a drag must cover to commit without a flick. */
export const SWIPE_COMMIT_FRACTION = 0.35;
/** Release speed, in px/ms, that commits a short flick. */
export const SWIPE_FLICK_VELOCITY = 0.5;

/** Width used when the host has not been laid out (for example in tests). */
const FALLBACK_WIDTH = 360;
/** Only travel inside this window decides the release velocity. */
const VELOCITY_WINDOW_MS = 100;
/** Ring size for the samples that window is read from. */
const SAMPLE_COUNT = 16;

/**
 * Pure decision on release. A drag commits when it covers a set share of the
 * screen, or when it is a quick flick in the direction of travel. It is never
 * committed on a short or slow nudge, so a half-made gesture springs back.
 */
export function shouldCommitSwipe(release: SwipeRelease, width: number): boolean {
  const distance = Math.abs(release.dx);
  const screen = width > 0 ? width : FALLBACK_WIDTH;
  if (distance >= screen * SWIPE_COMMIT_FRACTION) return true;
  const flick = distance >= DEFAULT_SWIPE_THRESHOLD && Math.sign(release.velocity) === Math.sign(release.dx);
  return flick && Math.abs(release.velocity) >= SWIPE_FLICK_VELOCITY;
}

/** Elements whose own drag, selection or scroll behaviour must win. */
const INTERACTIVE =
  "input, textarea, select, button, a, label, summary, [contenteditable], [role='switch'], [data-no-swipe]";

export interface SwipeOptions {
  /** Ratio that horizontal travel must reach over vertical to lock. */
  axisRatio?: number;
  /** Extra veto, consulted on pointerdown. The shell uses it for open dialogs. */
  isEnabled?(): boolean;
  /** The drag has locked as horizontal. `direction` is its initial side. */
  onDragStart(direction: SwipeDirection): void;
  /**
   * Horizontal offset since the pointer went down, in CSS px, negative when
   * the finger moved left. The content is placed at exactly this offset, so it
   * sits under the finger for the rest of the gesture.
   */
  onDragMove(offset: number): void;
  /** The finger lifted. The caller decides whether the drag commits. */
  onDragEnd(release: SwipeRelease): void;
  /** The browser or the platform took the pointer away mid-drag. */
  onDragCancel(): void;
}

/**
 * Attaches the gesture to `target`. Returns a function that removes every
 * listener again.
 */
export function attachSwipe(target: HTMLElement, options: SwipeOptions): () => void {
  const axisRatio = options.axisRatio ?? DEFAULT_SWIPE_AXIS_RATIO;
  let startX = 0;
  let startY = 0;
  let candidate = false;
  let locked = false;
  let pointerId = -1;
  // Recent pointer positions, in fixed typed buffers: recording a sample is an
  // index write, so a fast drag never allocates and never collects garbage.
  const sampleTime = new Float64Array(SAMPLE_COUNT);
  const sampleX = new Float64Array(SAMPLE_COUNT);
  let sampleHead = 0;
  let sampleCount = 0;

  const recordSample = (x: number, t = performance.now()) => {
    sampleTime[sampleHead] = t;
    sampleX[sampleHead] = x;
    sampleHead = (sampleHead + 1) % SAMPLE_COUNT;
    if (sampleCount < SAMPLE_COUNT) sampleCount += 1;
  };

  /** Travel per millisecond over the last VELOCITY_WINDOW_MS of the gesture. */
  const velocity = (): number => {
    if (sampleCount < 2) return 0;
    const newest = (sampleHead - 1 + SAMPLE_COUNT) % SAMPLE_COUNT;
    const newestTime = sampleTime[newest];
    let oldest = newest;
    for (let step = 1; step < sampleCount; step += 1) {
      const index = (newest - step + SAMPLE_COUNT * 2) % SAMPLE_COUNT;
      if (newestTime - sampleTime[index] > VELOCITY_WINDOW_MS) break;
      oldest = index;
    }
    const elapsed = newestTime - sampleTime[oldest];
    return elapsed > 0 ? (sampleX[newest] - sampleX[oldest]) / elapsed : 0;
  };

  const reset = () => {
    candidate = false;
    locked = false;
    sampleCount = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    // Primary button only; secondary and middle clicks are not gestures.
    if (!event.isPrimary || event.button !== 0) return;
    if (options.isEnabled && !options.isEnabled()) return;
    const origin = event.target as Element | null;
    // Let controls keep their own pointer behaviour.
    if (origin?.closest?.(INTERACTIVE)) return;
    reset();
    candidate = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    recordSample(startX);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!candidate || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!locked) {
      const horizontal = Math.abs(dx) >= SWIPE_LOCK_SLOP && Math.abs(dx) >= Math.abs(dy) * axisRatio;
      if (horizontal) {
        locked = true;
        // Keep the drag even if the pointer leaves the host. Capture is taken
        // only now, so taps on controls are never redirected.
        try {
          target.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is a refinement; the drag still works without it.
        }
        options.onDragStart(dx < 0 ? "left" : "right");
      } else if (Math.abs(dy) >= SWIPE_LOCK_SLOP) {
        // Vertical intent: hand the gesture back to the page untouched.
        candidate = false;
        return;
      } else {
        return;
      }
    }
    recordSample(event.clientX);
    // Absolute travel: the card is offset by exactly what the finger has moved
    // since it went down, so it sits under the finger for the whole drag.
    options.onDragMove(dx);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!candidate || event.pointerId !== pointerId) return;
    const wasLocked = locked;
    const dx = event.clientX - startX;
    if (wasLocked) recordSample(event.clientX);
    const release = { dx, velocity: velocity() };
    reset();
    if (wasLocked) options.onDragEnd(release);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!candidate || event.pointerId !== pointerId) return;
    const wasLocked = locked;
    reset();
    if (wasLocked) options.onDragCancel();
  };

  const onPointerLeave = (event: PointerEvent) => {
    // Before the lock, leaving the host abandons the gesture. After it, the
    // captured pointer keeps reporting, so leave is ignored.
    if (!candidate || event.pointerId !== pointerId || locked) return;
    reset();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerCancel);
  target.addEventListener("pointerleave", onPointerLeave);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerCancel);
    target.removeEventListener("pointerleave", onPointerLeave);
  };
}
