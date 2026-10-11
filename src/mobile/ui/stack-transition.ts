/**
 * Interactive stacked-card transition between top-level destinations.
 *
 * The active screen is a card that follows the finger. The neighbouring
 * destination is staged underneath it, scaled down once, and dimmed by a veil
 * whose opacity is written per frame.
 *
 * Why it is written this way. On a phone the drag loop must never do work the
 * compositor could do instead: a frame that forces layout, recalculates style
 * across a screen subtree or repaints a full-screen layer costs several
 * milliseconds on a mid-range device, and a finger produces one such frame
 * every 16 ms (measurements and the regression test are in
 * `tests/android/swipe-performance.spec.ts`). So, per frame, this module
 * performs exactly two writes — one `transform` on the card under the finger
 * and one `opacity` on the veil over the staged page — on two elements, both
 * compositor-only properties. It reads nothing at all: the screen width is
 * measured by the shell, outside the gesture.
 *
 * The staged page's own movement is not driven from here: it is a CSS class
 * that scales it to `STACK_BACK_SCALE` once, and a short compositor transition
 * that grows it back to full size after the card has left. Neither costs a
 * main-thread frame.
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

/** Scale of the destination underneath while it is staged behind the card. */
export const STACK_BACK_SCALE = 0.92;
/** Opacity of the dim veil over the underlying card when the card is at rest. */
export const STACK_BACK_DIM = 0.3;
/** Share of the card width that a release-without-commit may drift at most. */
const EDGE_RESISTANCE = 0.25;
/** Fallback for the compositor transition that grows the staged card back. */
export const STACK_SETTLE_MS = 200;
const SETTLE_TIMEOUT_MS = STACK_SETTLE_MS + 200;

export interface StackPose {
  /** 0 when the card covers the screen, 1 when it has fully left. */
  progress: number;
  /** Opacity of the veil over the staged page. */
  dim: number;
}

/**
 * Visual state of the underlying destination for a card offset `x`. Pure.
 * The staged page keeps a fixed scale while the finger is down; only the veil
 * follows the drag, so no full-screen layer is re-rastered mid-gesture.
 */
export function stackPose(x: number, width: number): StackPose {
  const span = width > 0 ? width : 1;
  const progress = Math.min(1, Math.abs(x) / span);
  return { progress, dim: STACK_BACK_DIM * (1 - progress) };
}

export interface StackOptions {
  /**
   * Current width of the screen host, in CSS px. The shell caches it, so this
   * is a plain read: the gesture never asks the browser to lay anything out.
   */
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
/** Grows the incoming card back to full size with a compositor transition. */
const SETTLE_CLASS = "stack-settle";
const VEIL_SELECTOR = ".screen-veil";

export function createStackTransition(options: StackOptions): StackTransition {
  let phase: StackPhase = "idle";
  let active: HTMLElement | undefined;
  let under: { id: string; element: HTMLElement; direction: SwipeDirection } | undefined;
  let veil: HTMLElement | undefined;
  let stagedDirection: SwipeDirection | undefined;
  let x = 0;
  /** Last offset written to the card: an unmoved finger costs nothing. */
  let painted = Number.NaN;
  /** Screen width captured when the gesture locked: never read mid-drag. */
  let span = 0;
  /** Side the drag started on: used until the offset itself shows a side. */
  let startDirection: SwipeDirection = "left";
  let spring: SpringRun | undefined;
  let settleTimer = 0;

  const clearElement = (element: HTMLElement | undefined) => {
    if (!element) return;
    element.classList.remove(ACTIVE_CLASS, UNDER_CLASS, MOVING_CLASS);
    element.style.transform = "";
  };

  /** Puts both containers back into the ordinary, unstacked layout. */
  const clearVisuals = () => {
    clearElement(active);
    clearElement(under?.element);
    if (veil) veil.style.opacity = "";
  };

  /** Hides the staged destination again, unless it is the active one. */
  const dropUnder = () => {
    if (under && under.element !== active) under.element.hidden = true;
    if (under) {
      under.element.classList.remove(UNDER_CLASS, MOVING_CLASS);
      under.element.style.transform = "";
    }
    if (veil) veil.style.opacity = "";
    under = undefined;
    veil = undefined;
    stagedDirection = undefined;
  };

  /**
   * Reveals the destination for `direction` once per gesture (and again only
   * if the finger crosses back), never per frame.
   */
  const stage = (direction: SwipeDirection) => {
    const id = options.neighbour(direction);
    if (!id) {
      dropUnder();
      return;
    }
    if (under?.id === id) {
      under.direction = direction;
      return;
    }
    dropUnder();
    const element = options.prepare(id);
    if (!element || element === active) return;
    element.hidden = false;
    // Class-driven, so the staged page is scaled, promoted and dimmed without
    // a single layout or paint pass of its own during the drag.
    element.classList.add(UNDER_CLASS, MOVING_CLASS);
    under = { id, element, direction };
    veil = element.querySelector<HTMLElement>(VEIL_SELECTOR) ?? undefined;
    if (veil) veil.style.opacity = String(STACK_BACK_DIM);
  };

  /** One compositor-only write per element per frame. */
  const paint = (offset: number) => {
    x = offset;
    painted = offset;
    // The offset is zero at the lock, so the start side decides until it moves.
    const direction: SwipeDirection = offset === 0 ? startDirection : offset < 0 ? "left" : "right";
    if (direction !== stagedDirection) {
      stagedDirection = direction;
      stage(direction);
    }
    if (!active) return;
    if (!under) {
      // Nothing to reveal here (an edge, or a screen outside the tab bar):
      // the card gives a little, then returns, rather than moving freely.
      active.style.transform = `translate3d(${offset * EDGE_RESISTANCE}px,0,0)`;
      return;
    }
    active.style.transform = `translate3d(${offset}px,0,0)`;
    if (veil) veil.style.opacity = stackPose(offset, span).dim.toFixed(3);
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

  /**
   * Lets the incoming card grow back to full size on the compositor, then
   * hands the element back untouched. `transitionend` is the real signal; the
   * timer is only a fallback for a transition that never runs.
   */
  const onSettleEnd = (element: HTMLElement, done: () => void) => {
    const finish = () => {
      window.clearTimeout(settleTimer);
      element.removeEventListener("transitionend", finish);
      done();
    };
    element.addEventListener("transitionend", finish);
    settleTimer = window.setTimeout(finish, SETTLE_TIMEOUT_MS);
  };

  const finishCommit = () => {
    spring = undefined;
    phase = "idle";
    const target = under;
    const id = target?.id;
    const element = target?.element;
    const veilElement = veil;
    under = undefined;
    veil = undefined;
    stagedDirection = undefined;
    // The outgoing card is already off-screen, so clearing it changes nothing
    // that is on screen: navigation happens on the frame after this one.
    clearElement(active);
    active = undefined;
    if (veilElement) veilElement.style.opacity = "";
    if (element) {
      // The card is in exactly the place the finger left it; this only grows
      // it to full size, with no per-frame main-thread work at all.
      element.classList.remove(UNDER_CLASS, MOVING_CLASS);
      element.classList.add(SETTLE_CLASS);
      onSettleEnd(element, () => element.classList.remove(SETTLE_CLASS));
    }
    if (!id) return;
    const moved = options.commit(id);
    if (!moved && element) {
      element.classList.remove(SETTLE_CLASS);
      element.hidden = true;
    }
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
      span = options.width();
      x = 0;
      painted = Number.NaN;
      stagedDirection = undefined;
      under = undefined;
      veil = undefined;
      startDirection = direction;
      phase = "dragging";
      if (options.reducedMotion()) return;
      active.classList.add(ACTIVE_CLASS, MOVING_CLASS);
      // Hand the card to the compositor in the frame the gesture locks, so the
      // first pixel of travel is already a compositor update.
      active.style.transform = "translate3d(0,0,0)";
      painted = 0;
    },

    move(offset) {
      if (phase !== "dragging" || !active) return;
      if (options.reducedMotion()) {
        x = offset;
        return;
      }
      if (offset === painted) return;
      paint(offset);
    },

    end(release) {
      if (phase !== "dragging") return;
      const width = span;
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
      const span2 = width > 0 ? width : 1;
      // The card leaves the way the finger travelled, never the way the offset
      // happens to point at the instant of release.
      const target = (travelled === "left" ? -1 : 1) * span2;
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
      const element = under?.element;
      const veilElement = veil;
      clearElement(active);
      clearElement(element);
      if (element) element.classList.remove(SETTLE_CLASS);
      if (veilElement) veilElement.style.opacity = "";
      active = undefined;
      dropUnder();
    },
  };
}
