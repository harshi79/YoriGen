/**
 * A damped spring for interactive screen transitions.
 *
 * The integrator is pure and deterministic so it can be tested without a
 * browser. `runSpring` drives it from requestAnimationFrame and hands back a
 * handle that can stop the motion at any frame, which is what lets a tap or a
 * Back press interrupt a transition cleanly.
 */

export interface SpringConfig {
  /** Restoring force per pixel of displacement. */
  stiffness: number;
  /** Friction per px/s of velocity. */
  damping: number;
  mass?: number;
}

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Settles with a slight, natural overshoot (damping ratio ~0.77). Used when
 * a swipe commits, so the incoming page lands with a small give.
 */
export const COMMIT_SPRING: SpringConfig = { stiffness: 380, damping: 30 };

/**
 * Critically damped (damping ratio ~1.0): returns to rest without overshoot.
 * Used when a swipe is abandoned, so a card never swings past its origin.
 */
export const RELEASE_SPRING: SpringConfig = { stiffness: 420, damping: 42 };

/** Positions closer than this to the target, at this speed, count as rest. */
export const REST_POSITION_EPSILON = 0.5;
export const REST_VELOCITY_EPSILON = 10;

/** Integrate in steps no larger than this, however late a frame arrives. */
const MAX_STEP_SECONDS = 1 / 120;
/** A stalled tab must not catapult the spring: clamp the frame delta. */
const MAX_FRAME_SECONDS = 1 / 30;

/** Advances the spring by `seconds` toward `target`. Pure. */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  seconds: number,
): SpringState {
  const mass = config.mass ?? 1;
  const steps = Math.max(1, Math.ceil(seconds / MAX_STEP_SECONDS));
  const dt = seconds / steps;
  let { x, v } = state;
  for (let i = 0; i < steps; i += 1) {
    const acceleration = (-config.stiffness * (x - target) - config.damping * v) / mass;
    // Semi-implicit Euler: stable at the step sizes used here.
    v += acceleration * dt;
    x += v * dt;
  }
  return { x, v };
}

export function isSpringAtRest(state: SpringState, target: number): boolean {
  return Math.abs(state.x - target) < REST_POSITION_EPSILON && Math.abs(state.v) < REST_VELOCITY_EPSILON;
}

export interface SpringRunOptions {
  from: number;
  /** Initial velocity in px per second. */
  velocity: number;
  target: number;
  config: SpringConfig;
  onFrame(state: SpringState): void;
  onRest(): void;
  /** Injectable clock and scheduler for tests. */
  now?: () => number;
  schedule?: (callback: (time: number) => void) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}

export interface SpringRun {
  /** Stops the motion without calling `onRest`. Safe to call more than once. */
  cancel(): void;
}

/** Runs a spring on animation frames until it rests, then calls `onRest`. */
export function runSpring(options: SpringRunOptions): SpringRun {
  const now = options.now ?? (() => performance.now());
  const schedule =
    options.schedule ?? ((callback: (time: number) => void) => requestAnimationFrame(callback));
  const cancelSchedule =
    options.cancelSchedule ?? ((handle: unknown) => cancelAnimationFrame(handle as number));

  let state: SpringState = { x: options.from, v: options.velocity };
  let last = now();
  let handle: unknown;
  let done = false;

  const frame = () => {
    if (done) return;
    const time = now();
    const seconds = Math.min(Math.max(time - last, 0) / 1000, MAX_FRAME_SECONDS);
    last = time;
    state = stepSpring(state, options.target, options.config, seconds);
    if (isSpringAtRest(state, options.target)) {
      done = true;
      options.onFrame({ x: options.target, v: 0 });
      options.onRest();
      return;
    }
    options.onFrame(state);
    handle = schedule(frame);
  };

  // Paint the starting pose immediately so the first frame is not stale.
  options.onFrame(state);
  handle = schedule(frame);

  return {
    cancel() {
      if (done) return;
      done = true;
      cancelSchedule(handle);
    },
  };
}
