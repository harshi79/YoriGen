// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStackTransition, stackPose, STACK_BACK_DIM, STACK_BACK_SCALE, type StackOptions } from "./stack-transition";

const ORDER = ["generator", "lookup", "sorter", "settings"];

/** Builds a fake shell: one container per destination, neighbours by order. */
function fixture(overrides: Partial<StackOptions> & { active?: string } = {}) {
  const host = document.createElement("main");
  document.body.append(host);
  const containers = new Map<string, HTMLElement>();
  const veils = new Map<string, HTMLElement>();
  for (const id of ORDER) {
    const element = document.createElement("section");
    element.className = "screen-host";
    element.dataset.screen = id;
    element.hidden = id !== (overrides.active ?? "generator");
    const veil = document.createElement("div");
    veil.className = "screen-veil";
    element.append(veil);
    veils.set(id, veil);
    host.append(element);
    containers.set(id, element);
  }
  let current = overrides.active ?? "generator";
  const options: StackOptions = {
    width: () => 400,
    reducedMotion: () => false,
    activeId: () => current,
    neighbour: (direction) => {
      const index = ORDER.indexOf(current);
      return ORDER[direction === "left" ? index + 1 : index - 1] ?? null;
    },
    prepare: vi.fn((id: string) => containers.get(id)),
    container: (id: string) => containers.get(id),
    commit: vi.fn((id: string) => {
      current = id;
      for (const [key, element] of containers) element.hidden = key !== id;
      return true;
    }),
    ...overrides,
  };
  return { stack: createStackTransition(options), containers, veils, options, host };
}

const el = (containers: Map<string, HTMLElement>, id: string) => containers.get(id)!;
const veilOf = (veils: Map<string, HTMLElement>, id: string) => veils.get(id)!;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("stackPose", () => {
  it("dims the staged page fully at rest and clears the dim as the card leaves", () => {
    expect(stackPose(0, 400)).toEqual({ progress: 0, dim: STACK_BACK_DIM });
    const pose = stackPose(-200, 400);
    expect(pose.progress).toBe(0.5);
    expect(pose.dim).toBeCloseTo(0.15, 5);
    expect(stackPose(-400, 400)).toMatchObject({ progress: 1, dim: 0 });
    expect(stackPose(-900, 400)).toMatchObject({ progress: 1, dim: 0 });
  });

  it("moves the dim in both directions, symmetrically", () => {
    expect(stackPose(120, 400)).toEqual(stackPose(-120, 400));
  });

  it("treats an unmeasured host as one pixel wide instead of dividing by zero", () => {
    // Before the shell has measured the host, a drag must still produce a
    // finite pose: any travel at all reads as the card having fully left.
    expect(stackPose(-10, 0)).toMatchObject({ progress: 1, dim: 0 });
    expect(stackPose(0, 0)).toEqual({ progress: 0, dim: STACK_BACK_DIM });
  });
});

describe("createStackTransition", () => {
  it("follows the finger and stages the next page underneath while dragging", () => {
    const { stack, containers, veils } = fixture();
    stack.start("left");
    stack.move(-120);
    expect(stack.phase).toBe("dragging");
    expect(stack.isBusy()).toBe(true);
    const card = el(containers, "generator");
    const under = el(containers, "lookup");
    expect(card.classList.contains("stack-top")).toBe(true);
    expect(card.style.transform).toBe("translate3d(-120px,0,0)");
    expect(under.hidden).toBe(false);
    expect(under.classList.contains("stack-under")).toBe(true);
    expect(veilOf(veils, "lookup").style.opacity).toBe(stackPose(-120, 400).dim.toFixed(3));
  });

  it("stages the next page once per gesture, not once per frame", () => {
    const { stack, options, containers } = fixture();
    stack.start("left");
    stack.move(-20);
    stack.move(-40);
    stack.move(-60);
    stack.move(-80);
    expect(options.prepare).toHaveBeenCalledTimes(1);
    const under = el(containers, "lookup");
    const classes = under.className;
    stack.move(-100);
    expect(under.className).toBe(classes);
  });

  it("reveals the previous page for a rightward drag", () => {
    const { stack, containers } = fixture({ active: "lookup" });
    stack.start("right");
    stack.move(90);
    expect(el(containers, "generator").hidden).toBe(false);
    expect(el(containers, "sorter").hidden).toBe(true);
  });

  it("does not prepare a neighbour at an edge; the card gives a little instead", () => {
    const { stack, containers, options } = fixture();
    stack.start("right");
    stack.move(60); // there is nothing before the first destination
    expect(options.prepare).not.toHaveBeenCalled();
    expect(el(containers, "generator").style.transform).toBe(`translate3d(${60 * 0.25}px,0,0)`);
  });

  it("never asks for the width while the finger is down", () => {
    // The shell caches the host width, so a drag does no layout work at all.
    const width = vi.fn(() => 400);
    const { stack } = fixture({ width });
    stack.start("left");
    const callsAtLock = width.mock.calls.length;
    for (let step = 1; step <= 40; step += 1) stack.move(-step * 5);
    expect(width.mock.calls.length).toBe(callsAtLock);
  });

  it("writes only a composited transform and opacity, nothing else", () => {
    // Every property the drag loop touches has to be one the compositor can
    // animate without a style recalculation, a layout pass or a repaint. The
    // browser-level proof (a Chromium metric assertion) lives in
    // tests/android/swipe-performance.spec.ts; this is the unit-level contract.
    const { stack, containers, veils } = fixture();
    stack.start("left");
    stack.move(-120);
    const card = el(containers, "generator");
    const under = el(containers, "lookup");
    expect(card.getAttribute("style")).toBe("transform: translate3d(-120px,0,0);");
    expect(veilOf(veils, "lookup").getAttribute("style")).toMatch(/^opacity: [\d.]+;$/);
    // The staged page itself is never written to while the finger moves: its
    // scale, promotion and dim come from classes.
    expect(under.getAttribute("style")).toBeNull();
    stack.move(-200);
    expect(card.getAttribute("style")).toBe("transform: translate3d(-200px,0,0);");
    expect(under.getAttribute("style")).toBeNull();
  });

  it("never writes a custom property, which would invalidate the whole subtree", () => {
    const { stack, containers, veils } = fixture();
    stack.start("left");
    stack.move(-120);
    for (const element of [el(containers, "generator"), el(containers, "lookup"), veilOf(veils, "lookup")]) {
      expect(element.getAttribute("style") ?? "").not.toContain("--");
    }
  });

  it("ignores a repeated offset instead of writing it again", () => {
    const { stack, containers } = fixture();
    stack.start("left");
    stack.move(-80);
    const card = el(containers, "generator");
    expect(card.style.transform).toBe("translate3d(-80px,0,0)");
    card.style.transform = "translate3d(-1px,0,0)"; // a value nothing else can produce
    stack.move(-80);
    expect(card.style.transform).toBe("translate3d(-1px,0,0)");
  });

  it("commits once the spring has settled, then clears every stacked style", async () => {
    const { stack, containers, veils, options } = fixture();
    stack.start("left");
    stack.move(-80);
    stack.end({ dx: -300, velocity: -0.6 });
    expect(stack.phase).toBe("settling");
    expect(options.commit).not.toHaveBeenCalled(); // nothing changes mid-animation
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("lookup"), { timeout: 2000, interval: 16 });
    expect(stack.phase).toBe("idle");
    const incoming = el(containers, "lookup");
    expect(incoming.hidden).toBe(false);
    expect(incoming.classList.contains("stack-under")).toBe(false);
    expect(incoming.classList.contains("stack-moving")).toBe(false);
    expect(incoming.style.transform).toBe("");
    expect(veilOf(veils, "lookup").style.opacity).toBe("");
    expect(el(containers, "generator").className).toBe("screen-host");
    // The incoming card grows back to full size on a compositor transition and
    // is handed back untouched when it ends.
    await vi.waitFor(() => expect(incoming.className).toBe("screen-host"), { timeout: 2000, interval: 16 });
    expect(incoming.classList.contains("stack-settle")).toBe(false);
  });

  it("springs back and never navigates when the drag is too short", async () => {
    const { stack, containers, veils, options } = fixture();
    stack.start("left");
    stack.move(-30);
    stack.end({ dx: -40, velocity: -0.1 });
    await vi.waitFor(() => expect(stack.phase).toBe("idle"), { timeout: 2000, interval: 16 });
    expect(options.commit).not.toHaveBeenCalled();
    expect(el(containers, "lookup").hidden).toBe(true);
    expect(el(containers, "generator").style.transform).toBe("");
    expect(veilOf(veils, "lookup").style.opacity).toBe("");
  });

  it("commits on a fast flick even when the distance is short", async () => {
    const { stack, options } = fixture();
    stack.start("left");
    stack.move(-70);
    stack.end({ dx: -70, velocity: -0.9 });
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("lookup"), { timeout: 2000, interval: 16 });
  });

  it("springs back when released in the direction opposite to the revealed page", async () => {
    const { stack, options } = fixture();
    stack.start("left");
    stack.move(-200); // reveals the next page
    stack.end({ dx: 200, velocity: 1 }); // finger ended on the other side
    await vi.waitFor(() => expect(stack.phase).toBe("idle"), { timeout: 2000, interval: 16 });
    expect(options.commit).not.toHaveBeenCalled();
  });

  it("swaps the staged page when the finger crosses back mid-gesture", async () => {
    const { stack, containers, veils, options } = fixture({ active: "lookup" });
    stack.start("left"); // the sorter is staged
    stack.move(-120);
    expect(el(containers, "sorter").hidden).toBe(false);
    stack.move(140); // the finger turned around: the generator takes its place
    expect(el(containers, "sorter").hidden).toBe(true);
    expect(el(containers, "generator").hidden).toBe(false);
    expect(el(containers, "generator").classList.contains("stack-under")).toBe(true);
    expect(el(containers, "lookup").style.transform).toBe("translate3d(140px,0,0)");
    expect(veilOf(veils, "sorter").style.opacity).toBe("");
    stack.end({ dx: 300, velocity: 0.8 });
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("generator"), { timeout: 2000, interval: 16 });
  });

  it("abort stops a settle immediately and restores the plain layout", async () => {
    const { stack, containers, veils, options } = fixture();
    stack.start("left");
    stack.move(-200);
    stack.end({ dx: -300, velocity: -0.5 });
    stack.abort();
    expect(stack.phase).toBe("idle");
    expect(el(containers, "generator").className).toBe("screen-host");
    expect(el(containers, "lookup").hidden).toBe(true);
    expect(veilOf(veils, "lookup").style.opacity).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(options.commit).not.toHaveBeenCalled();
    expect(el(containers, "lookup").className).toBe("screen-host");
  });

  it("cancel from a pointer-cancel settles back to rest", async () => {
    const { stack, containers, veils, options } = fixture();
    stack.start("left");
    stack.move(-150);
    stack.cancel();
    await vi.waitFor(() => expect(stack.phase).toBe("idle"), { timeout: 2000, interval: 16 });
    expect(options.commit).not.toHaveBeenCalled();
    expect(el(containers, "lookup").hidden).toBe(true);
    expect(veilOf(veils, "lookup").style.opacity).toBe("");
  });

  it("hides the staged page again when navigation is ignored at commit time", async () => {
    const { stack, containers, options } = fixture({ commit: vi.fn(() => false) });
    stack.start("left");
    stack.move(-250);
    stack.end({ dx: -250, velocity: -1 });
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalled(), { timeout: 2000, interval: 16 });
    expect(el(containers, "lookup").hidden).toBe(true);
    expect(el(containers, "lookup").classList.contains("stack-settle")).toBe(false);
  });

  it("ignores move and end calls that arrive when no drag is active", () => {
    const { stack, options } = fixture();
    stack.move(-100);
    stack.end({ dx: -300, velocity: -1 });
    stack.cancel();
    expect(stack.phase).toBe("idle");
    expect(options.commit).not.toHaveBeenCalled();
  });

  it("ignores a second start while a gesture is already in flight", () => {
    const { stack, containers, options } = fixture();
    stack.start("left");
    stack.move(-40);
    stack.start("right"); // a stray second pointerdown mid-drag
    stack.move(-60);
    expect(stack.phase).toBe("dragging");
    expect(el(containers, "generator").style.transform).toBe("translate3d(-60px,0,0)");
    // The page staged at the lock is still the one underneath: nothing was
    // re-prepared behind the finger.
    expect(el(containers, "lookup").hidden).toBe(false);
    expect(options.prepare).toHaveBeenCalledTimes(1);
  });

  it("does not start when the active destination has no container", () => {
    const { stack, options } = fixture({ container: () => undefined });
    stack.start("left");
    expect(stack.isBusy()).toBe(false);
    expect(stack.phase).toBe("idle");
    expect(options.prepare).not.toHaveBeenCalled();
  });

  it("does not stage a destination whose container the shell will not provide", () => {
    const { stack, containers, options } = fixture({ prepare: vi.fn(() => undefined) });
    stack.start("left");
    stack.move(-60);
    expect(options.prepare).toHaveBeenCalledWith("lookup");
    // Nothing to reveal: the card gives at the edge instead of moving freely.
    expect(el(containers, "generator").style.transform).toBe("translate3d(-15px,0,0)");
  });

  it("skips the veil when the staged page has no veil element", async () => {
    // The veil is a shell detail: a host that provides none must still drag and
    // commit, and every veil write must be skipped rather than throw.
    const { stack, containers, veils, options } = fixture();
    veilOf(veils, "lookup").remove();
    stack.start("left");
    stack.move(-80);
    expect(el(containers, "lookup").hidden).toBe(false);
    expect(el(containers, "lookup").classList.contains("stack-under")).toBe(true);
    stack.end({ dx: -300, velocity: -1 });
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("lookup"), { timeout: 2000, interval: 16 });
    expect(el(containers, "lookup").style.transform).toBe("");
  });

  it("commits a full-width exit on an unmeasured host without a NaN transform", async () => {
    // Width 0 happens before the first layout: the exit still has to resolve to
    // a real number rather than a NaN the compositor would drop.
    const { stack, containers, options } = fixture({ width: () => 0 });
    stack.start("left");
    stack.move(-70);
    stack.end({ dx: -70, velocity: -0.9 }); // a flick commits without a width
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("lookup"), { timeout: 2000, interval: 16 });
    expect(stack.phase).toBe("idle");
    expect(el(containers, "generator").getAttribute("style") ?? "").not.toContain("NaN");
    expect(el(containers, "lookup").getAttribute("style") ?? "").not.toContain("NaN");
  });

  describe("reduced motion", () => {
    it("never previews or animates, and navigates straight away on a committing release", () => {
      const { stack, containers, options } = fixture({ reducedMotion: () => true });
      stack.start("left");
      stack.move(-200);
      expect(options.prepare).not.toHaveBeenCalled();
      expect(el(containers, "generator").style.transform).toBe("");
      stack.end({ dx: -300, velocity: -1 });
      expect(options.commit).toHaveBeenCalledWith("lookup");
      expect(stack.phase).toBe("idle");
    });

    it("does nothing on a release that does not commit", () => {
      const { stack, options } = fixture({ reducedMotion: () => true });
      stack.start("left");
      stack.move(-30);
      stack.end({ dx: -30, velocity: 0 });
      expect(options.commit).not.toHaveBeenCalled();
      expect(stack.phase).toBe("idle");
    });

    it("drops an interrupted gesture straight back to idle", () => {
      // With motion reduced there is no preview and nothing to settle, so a
      // pointercancel must not leave the transition owning the host.
      const { stack, containers } = fixture({ reducedMotion: () => true });
      stack.start("left");
      stack.move(-120);
      stack.cancel();
      expect(stack.phase).toBe("idle");
      expect(stack.isBusy()).toBe(false);
      expect(el(containers, "generator").className).toBe("screen-host");
      expect(el(containers, "lookup").hidden).toBe(true);
    });
  });
});

describe("stack transition stylesheet contract", () => {
  // The transition and the stylesheet have to agree on two things the DOM tests
  // above cannot see: the scale the staged page is given by CSS, and that the
  // moving card carries no shadow, rounding or clipping — each of which turns a
  // composited move into a full-screen re-raster on Android.
  const css = readFileSync(join(process.cwd(), "src/mobile/styles/mobile.css"), "utf8");

  const rule = (selector: string) => {
    const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`missing rule: ${selector}`);
    return match[1];
  };

  it("scales the staged page by exactly STACK_BACK_SCALE", () => {
    expect(rule(".screen-host.stack-under")).toMatch(new RegExp(`transform:\\s*scale\\(${STACK_BACK_SCALE}\\)`));
  });

  it("keeps the moving cards free of shadows, rounding and clipping", () => {
    const moving = rule(".screen-host.stack-moving");
    expect(moving).toContain("will-change: transform");
    expect(moving).not.toMatch(/box-shadow|border-radius|overflow|filter/);
  });

  it("drives the staged dim from an element opacity, never a custom property", () => {
    expect(rule(".screen-host.stack-under .screen-veil")).toContain("will-change: opacity");
    expect(css).not.toContain("--stack-dim");
    expect(css).not.toMatch(/\.screen-host\.stack-under::after/);
  });
});
