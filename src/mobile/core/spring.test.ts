import { describe, expect, it, vi } from "vitest";
import {
  COMMIT_SPRING,
  RELEASE_SPRING,
  isSpringAtRest,
  runSpring,
  stepSpring,
  type SpringConfig,
} from "./spring";

/** Simulates `seconds` at 60 fps and returns the position over time. */
function trace(config: SpringConfig, from: number, velocity: number, target: number, seconds: number) {
  let state = { x: from, v: velocity };
  const xs: number[] = [];
  for (let t = 0; t < seconds * 60; t += 1) {
    state = stepSpring(state, target, config, 1 / 60);
    xs.push(state.x);
  }
  return { xs, state };
}

describe("stepSpring", () => {
  it("settles on the target from a displacement", () => {
    const { state } = trace(COMMIT_SPRING, 0, 0, 100, 2);
    expect(Math.abs(state.x - 100)).toBeLessThan(0.5);
    expect(Math.abs(state.v)).toBeLessThan(10);
    expect(isSpringAtRest(state, 100)).toBe(true);
  });

  it("overshoots a little with the commit spring, for a natural give", () => {
    const { xs } = trace(COMMIT_SPRING, 0, 0, 100, 2);
    expect(Math.max(...xs)).toBeGreaterThan(100);
    expect(Math.max(...xs)).toBeLessThan(110);
  });

  it("never overshoots with the release spring, so an abandoned card does not swing past its start", () => {
    const { xs } = trace(RELEASE_SPRING, 80, 0, 0, 2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.001);
    expect(Math.abs(xs[xs.length - 1])).toBeLessThan(0.5);
  });

  it("carries an initial velocity into the motion", () => {
    const still = trace(COMMIT_SPRING, 0, 0, 100, 0.05).state.x;
    const flicked = trace(COMMIT_SPRING, 0, 2000, 100, 0.05).state.x;
    expect(flicked).toBeGreaterThan(still);
  });

  it("stays stable for a large step, so a stalled frame cannot catapult the card", () => {
    const state = stepSpring({ x: 0, v: 0 }, 100, COMMIT_SPRING, 10);
    expect(Number.isFinite(state.x)).toBe(true);
    expect(Math.abs(state.x - 100)).toBeLessThan(5);
  });

  it("is a no-op at rest on the target", () => {
    expect(stepSpring({ x: 50, v: 0 }, 50, COMMIT_SPRING, 1)).toEqual({ x: 50, v: 0 });
  });
});

describe("runSpring", () => {
  function manualClock() {
    let time = 0;
    let frame: ((t: number) => void) | undefined;
    let handle = 0;
    return {
      now: () => time,
      schedule: (callback: (t: number) => void) => {
        frame = callback;
        handle += 1;
        return handle;
      },
      cancelSchedule: vi.fn(),
      tick(ms: number) {
        time += ms;
        const callback = frame;
        frame = undefined;
        callback?.(time);
      },
      pending: () => frame !== undefined,
    };
  }

  it("paints the start pose, then animates frame by frame until it rests", () => {
    const clock = manualClock();
    const onFrame = vi.fn();
    const onRest = vi.fn();
    runSpring({ from: 0, velocity: 0, target: 100, config: COMMIT_SPRING, onFrame, onRest, ...clock });
    expect(onFrame).toHaveBeenCalledWith({ x: 0, v: 0 });
    for (let i = 0; i < 400 && !onRest.mock.calls.length; i += 1) clock.tick(16);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenLastCalledWith({ x: 100, v: 0 }); // lands exactly on target
    expect(clock.pending()).toBe(false);
  });

  it("stops without resting when cancelled, and schedules nothing more", () => {
    const clock = manualClock();
    const onRest = vi.fn();
    const run = runSpring({ from: 0, velocity: 0, target: 100, config: COMMIT_SPRING, onFrame: vi.fn(), onRest, ...clock });
    clock.tick(16);
    run.cancel();
    run.cancel(); // idempotent
    expect(clock.cancelSchedule).toHaveBeenCalledTimes(1);
    clock.tick(16);
    expect(onRest).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(false);
  });

  it("clamps a long frame gap so one late frame does not skip the motion", () => {
    const clock = manualClock();
    const onFrame = vi.fn();
    runSpring({ from: 0, velocity: 0, target: 100, config: COMMIT_SPRING, onFrame, onRest: vi.fn(), ...clock });
    clock.tick(5000); // a tab that was in the background
    const [state] = onFrame.mock.calls.at(-1) as [{ x: number }];
    expect(state.x).toBeLessThan(100);
  });
});
