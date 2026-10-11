// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStackTransition, stackPose, STACK_BACK_DIM, STACK_BACK_SCALE, type StackOptions } from "./stack-transition";

const ORDER = ["generator", "lookup", "sorter", "settings"];

/** Builds a fake shell: one container per destination, neighbours by order. */
function fixture(overrides: Partial<StackOptions> & { active?: string } = {}) {
  const host = document.createElement("main");
  document.body.append(host);
  const containers = new Map<string, HTMLElement>();
  for (const id of ORDER) {
    const element = document.createElement("section");
    element.className = "screen-host";
    element.dataset.screen = id;
    element.hidden = id !== (overrides.active ?? "generator");
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
  return { stack: createStackTransition(options), containers, options, host };
}

const el = (containers: Map<string, HTMLElement>, id: string) => containers.get(id)!;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("stackPose", () => {
  it("rests the underlying page slightly scaled and dimmed", () => {
    expect(stackPose(0, 400)).toEqual({ progress: 0, scale: STACK_BACK_SCALE, dim: STACK_BACK_DIM });
  });

  it("grows the underlying page to full size and clears the dim as the card leaves", () => {
    const pose = stackPose(-200, 400);
    expect(pose.progress).toBe(0.5);
    expect(pose.scale).toBeCloseTo(0.96, 5);
    expect(pose.dim).toBeCloseTo(0.15, 5);
    expect(stackPose(-400, 400)).toMatchObject({ progress: 1, scale: 1, dim: 0 });
    expect(stackPose(-900, 400)).toMatchObject({ progress: 1, scale: 1, dim: 0 });
  });
});

describe("createStackTransition", () => {
  it("follows the finger and stages the next page underneath while dragging", () => {
    const { stack, containers } = fixture();
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
    expect(under.style.transform).toBe(`scale(${stackPose(-120, 400).scale})`);
    expect(under.style.getPropertyValue("--stack-dim")).toBe(stackPose(-120, 400).dim.toFixed(3));
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

  it("commits once the spring has settled, then clears every stacked style", async () => {
    const { stack, containers, options } = fixture();
    stack.start("left");
    stack.move(-80);
    stack.end({ dx: -300, velocity: -0.6 });
    expect(stack.phase).toBe("settling");
    expect(options.commit).not.toHaveBeenCalled(); // nothing changes mid-animation
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalledWith("lookup"), { timeout: 2000, interval: 16 });
    expect(stack.phase).toBe("idle");
    const incoming = el(containers, "lookup");
    expect(incoming.hidden).toBe(false);
    expect(incoming.className).toBe("screen-host");
    expect(incoming.style.transform).toBe("");
    expect(el(containers, "generator").className).toBe("screen-host");
  });

  it("springs back and never navigates when the drag is too short", async () => {
    const { stack, containers, options } = fixture();
    stack.start("left");
    stack.move(-30);
    stack.end({ dx: -40, velocity: -0.1 });
    await vi.waitFor(() => expect(stack.phase).toBe("idle"), { timeout: 2000, interval: 16 });
    expect(options.commit).not.toHaveBeenCalled();
    expect(el(containers, "lookup").hidden).toBe(true);
    expect(el(containers, "generator").style.transform).toBe("");
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

  it("abort stops a settle immediately and restores the plain layout", async () => {
    const { stack, containers, options } = fixture();
    stack.start("left");
    stack.move(-200);
    stack.end({ dx: -300, velocity: -0.5 });
    stack.abort();
    expect(stack.phase).toBe("idle");
    expect(el(containers, "generator").className).toBe("screen-host");
    expect(el(containers, "lookup").hidden).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(options.commit).not.toHaveBeenCalled();
  });

  it("cancel from a pointer-cancel settles back to rest", async () => {
    const { stack, containers, options } = fixture();
    stack.start("left");
    stack.move(-150);
    stack.cancel();
    await vi.waitFor(() => expect(stack.phase).toBe("idle"), { timeout: 2000, interval: 16 });
    expect(options.commit).not.toHaveBeenCalled();
    expect(el(containers, "lookup").hidden).toBe(true);
  });

  it("hides the staged page again when navigation is ignored at commit time", async () => {
    const { stack, containers, options } = fixture({ commit: vi.fn(() => false) });
    stack.start("left");
    stack.move(-250);
    stack.end({ dx: -250, velocity: -1 });
    await vi.waitFor(() => expect(options.commit).toHaveBeenCalled(), { timeout: 2000, interval: 16 });
    expect(el(containers, "lookup").hidden).toBe(true);
  });

  it("ignores move and end calls that arrive when no drag is active", () => {
    const { stack, options } = fixture();
    stack.move(-100);
    stack.end({ dx: -300, velocity: -1 });
    stack.cancel();
    expect(stack.phase).toBe("idle");
    expect(options.commit).not.toHaveBeenCalled();
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
  });
});
