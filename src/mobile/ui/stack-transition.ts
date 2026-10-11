/**
 * Interactive stacked-card transition between top-level destinations.
 *
 * The active screen is a card that follows the finger. The neighbouring
 * destination sits underneath it, scaled down and dimmed, and grows into place
 * as the card moves away. On release the card either completes the move on a
 * spring (when the drag passed the commit distance or was a flick) or springs
 * back to rest.
 *
 * This module only moves containers. Navigation state, the screen lifecycle
 * and the hash all still belong to the shell. The shell calls `commit` only
 * once the spring has settled, so a single navigation change happens exactly
 * when the visuals are already in their final place: nothing flashes, and no
 * blank frame appears between the old and the new page.
 */
import type { SwipeDirection, SwipeRelease } from "../core/swipe";
import { shouldCommitSwipe } from "../core/swipe";
import { COMMIT_SPRING, RELEASE_SPRING, runSpring, type SpringRun, type SpringState } from "../core/spring";

/** Scale of the destination underneath when the card is at rest. */
export const STACK_BACK_SCALE = 0.92;
/** Opacity of the dim veil over the underlying card when the card is at rest. */
export const STACK_BACK_DIM = 0.3;
/** Share of the card width that a release-without-commit may drift at most. */
const EDGE_RESISTANCE = 0.25;

export interface StackPose {
  /** 0 when the card covers the screen, 1 when it has fully left. */
  progress: number;
  scale: number;
  dim: number;
}

/** Visual state of the underlying destination for a card offset `x`. Pure. */
export function stackPose(x: number, width: number): StackPose {
  const span = width > 0 ? width : 1;
  const progress = Math.min(1, Math.abs(x) / span);
  return {
    progress,
    scale: STACK_BACK_SCALE + (1 - STACK_BACK_SCALE) * progress,
    dim: STACK_BACK_DIM * (1 - progress),
  };
}

export interface StackOptions {
  /** Current width of the screen host, in CSS px. */
  width(): number;
  /** True when the user asked for reduced motion: no preview, no spring. */
  reducedMotion(): boolean;
  /** Id of the destination currently on screen. */
  activeId(): string;
  /** The destination a swipe in `direction` reveals, or null at an edge. */
  neighbour(direction: SwipeDirection): string | null;
  /** Makes sure the destination's screen exists and returns its container. */
  prepare(id: string): HTMLElement | undefined;
  /** Container for an existing destination. */
  container(id: string): HTMLElement | undefined;
  /** Navigates for real. Returns false when the navigation was ignored. */
  commit(id: string): boolean;
}

export type StackPhase = "idle" | "dragging" | "settling";

export interface StackTransition {
  readonly phase: StackPhase;
  /** True while a gesture or its settle animation owns the screen host. */
  isBusy(): boolean;
  start(direction: SwipeDirection): void;
  move(offset: number): void;
  end(release: SwipeRelease): void;
  cancel(): void;
  /**
   * Stops any transition immediately and restores the plain layout. Used when
   * another navigation starts, so the shell can take over the screen host.
   */
  abort(): void;
}

const ACTIVE_CLASS = "stack-top";
const UNDER_CLASS = "stack-under";
const MOVING_CLASS = "stack-moving";

export function createStackTransition(options: StackOptions): StackTransition {
  let phase: StackPhase = "idle";
  let active: HTMLElement | undefined;
  let under: { id: string; element: HTMLElement; direction: SwipeDirection } | undefined;
  let x = 0;
  /** Side the drag started on: used until the offset itself shows a side. */
  let startDirection: SwipeDirection = "left";
  let spring: SpringRun | undefined;

  const clearElement = (element: HTMLElement | undefined) => {
    if (!element) return;
    element.classList.remove(ACTIVE_CLASS, UNDER_CLASS, MOVING_CLASS);
    element.style.transform = "";
    element.style.removeProperty("--stack-dim");
  };

  /** Puts both containers back into the ordinary, unstacked layout. */
  const clearVisuals = () => {
    clearElement(active);
    clearElement(under?.element);
  };

  /** Hides the underlying destination again, unless it is the active one. */
  const dropUnder = () => {
    if (under && under.element !== active) under.element.hidden = true;
    under = undefined;
  };

  const ensureUnder = (direction: SwipeDirection) => {
    if (under?.direction === direction) return;
    dropUnder();
    const id = options.neighbour(direction);
    if (!id) return;
    const element = options.prepare(id);
    if (!element || element === active) return;
    element.hidden = false;
    element.classList.add(UNDER_CLASS, MOVING_CLASS);
    under = { id, element, direction };
  };

  const paint = (offset: number) => {
    x = offset;
    // The offset is zero at the lock, so the start side decides until it moves.
    const direction: SwipeDirection = offset === 0 ? startDirection : offset < 0 ? "left" : "right";
    ensureUnder(direction);
    if (!active) return;
    if (!under) {
      // Nothing to reveal here (an edge, or a screen outside the tab bar):
      // the card gives a little, then returns, rather than moving freely.
      active.style.transform = `translate3d(${offset * EDGE_RESISTANCE}px,0,0)`;
      return;
    }
    const pose = stackPose(offset, options.width());
    active.style.transform = `translate3d(${offset}px,0,0)`;
    under.element.style.transform = `scale(${pose.scale})`;
    under.element.style.setProperty("--stack-dim", pose.dim.toFixed(3));
  };

  const settleTo = (target: number, velocityPxPerSecond: number, onRest: () => void, config = RELEASE_SPRING) => {
    spring = runSpring({
      from: x,
      velocity: velocityPxPerSecond,
      target,
      config,
      onFrame: (state: SpringState) => paint(state.x),
      onRest,
    });
  };

  const finishCommit = () => {
    spring = undefined;
    phase = "idle";
    const target = under;
    const id = target?.id;
    clearVisuals();
    under = undefined;
    if (!id) return;
    // The screen is already in its final place. Navigation now makes it the
    // active one, without the directional entrance the tab buttons use.
    const moved = options.commit(id);
    if (!moved && target) target.element.hidden = true;
  };

  const finishRevert = () => {
    spring = undefined;
    phase = "idle";
    clearVisuals();
    dropUnder();
  };

  return {
    get phase() {
      return phase;
    },
    isBusy: () => phase !== "idle",

    start(direction) {
      if (phase !== "idle") return;
      active = options.container(options.activeId());
      if (!active) return;
      x = 0;
      startDirection = direction;
      phase = "dragging";
      if (!options.reducedMotion()) active.classList.add(ACTIVE_CLASS, MOVING_CLASS);
    },

    move(offset) {
      if (phase !== "dragging" || !active) return;
      if (options.reducedMotion()) {
        x = offset;
        return;
      }
      paint(offset);
    },

    end(release) {
      if (phase !== "dragging") return;
      const width = options.width();
      const travelled: SwipeDirection = release.dx < 0 ? "left" : "right";
      if (options.reducedMotion()) {
        // No preview and no spring: the navigation happens on release.
        phase = "idle";
        const id = options.neighbour(travelled);
        if (id && shouldCommitSwipe(release, width)) options.commit(id);
        return;
      }
      const commit = shouldCommitSwipe(release, width) && under?.direction === travelled;
      phase = "settling";
      if (!commit) {
        settleTo(0, release.velocity * 1000, finishRevert, RELEASE_SPRING);
        return;
      }
      const span = width > 0 ? width : 1;
      // The card leaves the way the finger travelled, never the way the offset
      // happens to point at the instant of release.
      const target = (travelled === "left" ? -1 : 1) * span;
      settleTo(target, release.velocity * 1000, finishCommit, COMMIT_SPRING);
    },

    cancel() {
      if (phase !== "dragging") return;
      if (options.reducedMotion()) {
        phase = "idle";
        return;
      }
      phase = "settling";
      settleTo(0, 0, finishRevert, RELEASE_SPRING);
    },

    abort() {
      if (phase === "idle") return;
      spring?.cancel();
      spring = undefined;
      phase = "idle";
      clearVisuals();
      dropUnder();
    },
  };
}
